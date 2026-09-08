// Ingestão: transforma texto BRUTO de fontes externas (conversas observadas do
// Telegram, e-mails, eventos de agenda) em FATOS curtos na tabela `memories`.
//
// Por que em lote e não por mensagem: um grupo movimentado geraria uma chamada
// de LLM por mensagem. A ingestão junta um bloco, faz UMA chamada no Ollama
// residente (custo zero) e grava só o que sobrou como fato durável.
//
// `ingestao_estado` guarda até onde cada fonte já foi lida, então rodar duas
// vezes não duplica nem reprocessa.
import type Database from 'better-sqlite3';

import type { Cerebro } from './memoria.js';
import type { GatewayLLM } from '../custo/gateway.js';

export interface ItemBruto {
  /** Id crescente e estável na fonte (rowid do log, timestamp do e-mail…). */
  id: number;
  texto: string;
}

export interface ResultadoIngestao {
  fonte: string;
  lidos: number;
  fatos: number;
  ultimoId: number;
  erro?: string;
}

const PROMPT = `Você extrai FATOS DURÁVEIS de um trecho de conversa ou de mensagens, em PT-BR.
Responda SOMENTE JSON: {"fatos":["frase curta", ...]}

O que é fato durável: decisão tomada, compromisso assumido, prazo, preferência declarada,
dado de pessoa (papel, empresa, contato), preço/valor combinado, mudança de plano.
O que NÃO é: saudação, piada, reação, pergunta sem resposta, comentário sobre o clima,
link sem contexto, qualquer coisa que só valha para os próximos minutos.

Regras: no máximo 8 fatos; cada um com até 20 palavras, auto-contido (quem, o quê, quando);
escreva o nome de quem falou quando importar; se não houver nada durável, devolva {"fatos":[]}.`;

export class Ingestao {
  constructor(
    private readonly db: Database.Database,
    private readonly cerebro: Cerebro,
    private readonly gateway: GatewayLLM,
    private readonly agora: () => number,
  ) {}

  ultimoId(fonte: string): number {
    const l = this.db.prepare('SELECT ultimo_id FROM ingestao_estado WHERE fonte = ?').get(fonte) as { ultimo_id: number } | undefined;
    return l?.ultimo_id ?? 0;
  }

  private marcar(fonte: string, ultimoId: number, itens: number): void {
    this.db.prepare(
      `INSERT INTO ingestao_estado (fonte, ultimo_id, ultimo_em, itens) VALUES (?, ?, ?, ?)
       ON CONFLICT(fonte) DO UPDATE SET ultimo_id = excluded.ultimo_id, ultimo_em = excluded.ultimo_em,
         itens = ingestao_estado.itens + excluded.itens`,
    ).run(fonte, ultimoId, this.agora(), itens);
  }

  estado(): { fonte: string; ultimo_id: number; ultimo_em: number; itens: number }[] {
    return this.db.prepare('SELECT * FROM ingestao_estado ORDER BY ultimo_em DESC').all() as {
      fonte: string; ultimo_id: number; ultimo_em: number; itens: number;
    }[];
  }

  /**
   * Extrai fatos de um bloco de itens e grava como memórias do `chatId`.
   * `fonte` vira a coluna `origem` (ex.: `telegram:-100123`, `gmail:pessoal`).
   */
  async ingerir(fonte: string, chatId: string, itens: ItemBruto[], modelo?: string): Promise<ResultadoIngestao> {
    const base: ResultadoIngestao = { fonte, lidos: itens.length, fatos: 0, ultimoId: this.ultimoId(fonte) };
    if (!itens.length) return base;
    const ultimoId = Math.max(...itens.map((i) => i.id));
    const bloco = itens.map((i) => i.texto.replace(/\s+/g, ' ').slice(0, 500)).join('\n').slice(0, 12000);
    try {
      const r = await this.gateway.chamar({
        tier: 'local', modelo, json: true, temperatura: 0.1, maxTokens: 500, timeoutMs: 240_000,
        agente: 'ingestao', chatId,
        mensagens: [{ role: 'system', content: PROMPT }, { role: 'user', content: bloco }],
      });
      const j = JSON.parse(r.texto.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { fatos?: unknown };
      const fatos = (Array.isArray(j.fatos) ? j.fatos : []).filter((f): f is string => typeof f === 'string' && f.trim().length > 8);
      let gravados = 0;
      for (const f of fatos.slice(0, 8)) {
        // `salvar` devolve null quando já existe (dedupe por hash) — não conta.
        if (this.cerebro.salvar(chatId, f.trim(), 'semantic', fonte)) gravados += 1;
      }
      // Marca aqui mesmo quando a resposta veio ilegível (fatos = []): um bloco
      // que o modelo não consegue processar não pode travar a fonte para sempre,
      // porque a leitura é `id > ultimo_id` e tudo que vier depois ficaria atrás
      // dele. Já uma FALHA de chamada (Ollama fora, timeout) cai no catch e NÃO
      // marca — essa é transitória e o bloco é relido na próxima passagem.
      this.marcar(fonte, ultimoId, itens.length);
      return { ...base, fatos: gravados, ultimoId };
    } catch (e) {
      return { ...base, erro: (e as Error).message };
    }
  }

  /**
   * Varre o `conversation_log` dos chats OBSERVADOS e ingere o que chegou desde
   * a última passagem, um bloco por chat.
   */
  async ingerirObservados(modelo?: string, maxPorChat = 120): Promise<ResultadoIngestao[]> {
    const chats = this.db.prepare(
      `SELECT DISTINCT chat_id AS c, canal FROM conversation_log WHERE agent_id = 'observado'`,
    ).all() as { c: string; canal: string }[];
    const out: ResultadoIngestao[] = [];
    for (const { c, canal } of chats) {
      const fonte = `${canal}:${c}`;
      const desde = this.ultimoId(fonte);
      const linhas = this.db.prepare(
        `SELECT id, content, session_id FROM conversation_log
          WHERE chat_id = ? AND agent_id = 'observado' AND id > ? ORDER BY id LIMIT ?`,
      ).all(c, desde, maxPorChat) as { id: number; content: string; session_id: string | null }[];
      if (linhas.length < 3) continue; // bloco curto demais para valer uma chamada
      const grupo = linhas[0].session_id ? `[${linhas[0].session_id}]\n` : '';
      const itens: ItemBruto[] = linhas.map((l) => ({ id: l.id, texto: l.content }));
      if (grupo) itens[0] = { ...itens[0], texto: grupo + itens[0].texto };
      out.push(await this.ingerir(fonte, c, itens, modelo));
    }
    return out;
  }
}
