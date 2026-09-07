// O ÚNICO ponto por onde uma chamada de LLM passa (regra de ouro 2).
// Escolhe o provedor pelo tier, checa orçamento, faz preflight de RAM no
// Ollama, mede latência, calcula custo e grava em `chamadas_llm`.
import { calcularCusto } from './precos.js';
import type { Orcamento } from './orcamento.js';
import type { RegistroCusto, Tier } from './registro.js';
import type { ConfigPrecos } from '../config/yaml.js';
import type { GestorOllama } from '../ollama/gestor.js';
import type { MensagemLLM, Provedor, RespostaLLM } from '../provedores/tipos.js';

export interface PedidoGateway {
  tier: Tier;
  mensagens: MensagemLLM[];
  /** Sobrescreve o modelo do tier (ex.: papel `roteador`/`embed` do Ollama). */
  modelo?: string;
  temperatura?: number;
  maxTokens?: number;
  timeoutMs?: number;
  sinal?: AbortSignal;
  json?: boolean;
  keepAlive?: string | number;
  agente?: string;
  jobId?: number;
  chatId?: string;
  traceId?: string;
  /** Obrigatório quando tier != local: por que subiu de tier (fica registrado). */
  motivoTier?: string;
}

export interface RespostaGateway extends RespostaLLM {
  provedor: string;
  modelo: string;
  tier: Tier;
  custoUsd: number;
  latenciaMs: number;
  /** Tier efetivamente usado pode ter caído (orçamento/RAM). */
  rebaixado?: string;
}

export class TravaOrcamento extends Error {}

export interface OpcoesGateway {
  provedores: Partial<Record<Provedor['nome'], Provedor>>;
  precos: ConfigPrecos;
  registro: RegistroCusto;
  orcamento: Orcamento;
  ollama: GestorOllama;
  log?: (m: string) => void;
}

export class GatewayLLM {
  constructor(private readonly o: OpcoesGateway) {}

  private alvo(tier: Tier, modelo?: string): { provedor: Provedor; modelo: string } {
    const t = this.o.precos.tiers[tier];
    const prov = this.o.provedores[t.provedor];
    if (!prov) throw new Error(`provedor ${t.provedor} indisponível para o tier ${tier} (key ausente?)`);
    return { provedor: prov, modelo: modelo ?? t.modelo };
  }

  async chamar(p: PedidoGateway): Promise<RespostaGateway> {
    let tier = p.tier;
    let rebaixado: string | undefined;

    // 1. Orçamento: trava dura só deixa passar o local.
    if (tier !== 'local') {
      const d = this.o.orcamento.avaliar(tier);
      if (!d.permitido) {
        if (this.o.provedores.ollama) { rebaixado = d.motivo; tier = 'local'; }
        else throw new TravaOrcamento(d.motivo);
      }
    }

    let { provedor, modelo } = this.alvo(tier, tier === 'local' ? p.modelo : undefined);

    // 2. Preflight de RAM no Ollama: modelo não residente só sobe com folga.
    if (tier === 'local') {
      const pf = await this.o.ollama.preflight(modelo);
      if (!pf.ok) {
        const barato = this.o.provedores[this.o.precos.tiers.barato.provedor];
        if (barato && this.o.orcamento.avaliar('barato').permitido) {
          rebaixado = `Ollama sem RAM para ${modelo}: ${pf.motivo} → barato`;
          tier = 'barato';
          ({ provedor, modelo } = this.alvo('barato'));
        } else {
          throw new Error(`Ollama não pode carregar ${modelo}: ${pf.motivo}`);
        }
      }
    }

    const t0 = Date.now();
    let resposta: RespostaLLM | undefined;
    let erro: string | undefined;
    try {
      resposta = await provedor.chamar({
        modelo, mensagens: p.mensagens, temperatura: p.temperatura, maxTokens: p.maxTokens,
        timeoutMs: p.timeoutMs, sinal: p.sinal, json: p.json, keepAlive: p.keepAlive,
      });
      if (provedor.nome === 'ollama') this.o.ollama.marcarMeu(modelo);
    } catch (e) {
      erro = (e as Error).message;
    }
    const latenciaMs = Date.now() - t0;
    const custoUsd = resposta
      ? (resposta.custoUsdInformado ?? calcularCusto(this.o.precos, provedor.nome, modelo, resposta.tokensIn, resposta.tokensOut, resposta.tokensCache))
      : 0;

    this.o.registro.gravar({
      traceId: p.traceId, provedor: provedor.nome, modelo, tier, agente: p.agente, jobId: p.jobId, chatId: p.chatId,
      tokensIn: resposta?.tokensIn ?? 0, tokensOut: resposta?.tokensOut ?? 0, tokensCache: resposta?.tokensCache ?? 0,
      custoUsd, latenciaMs, ok: !erro, erro, motivoTier: rebaixado ?? p.motivoTier,
    });
    if (rebaixado) this.o.log?.(`[llm] tier rebaixado: ${rebaixado}`);

    if (erro || !resposta) throw new Error(erro ?? 'resposta vazia');
    return { ...resposta, provedor: provedor.nome, modelo, tier, custoUsd, latenciaMs, rebaixado };
  }

  /** Embedding local (bge-m3). Também passa pelo registro (tokens e tempo). */
  async embed(textos: string[], modelo: string, traceId?: string): Promise<number[][]> {
    const prov = this.o.provedores.ollama;
    if (!prov) throw new Error('Ollama indisponível para embeddings');
    const pf = await this.o.ollama.preflight(modelo);
    if (!pf.ok) throw new Error(`sem RAM para ${modelo}: ${pf.motivo}`);
    const t0 = Date.now();
    const { ollamaEmbed } = await import('../ollama/cliente.js');
    try {
      const r = await ollamaEmbed(modelo, textos);
      this.o.ollama.marcarMeu(modelo);
      this.o.registro.gravar({ traceId, provedor: 'ollama', modelo, tier: 'local', agente: 'embed', tokensIn: r.promptTokens, tokensOut: 0, custoUsd: 0, latenciaMs: Date.now() - t0, ok: true });
      return r.embeddings;
    } catch (e) {
      this.o.registro.gravar({ traceId, provedor: 'ollama', modelo, tier: 'local', agente: 'embed', tokensIn: 0, tokensOut: 0, custoUsd: 0, latenciaMs: Date.now() - t0, ok: false, erro: (e as Error).message });
      throw e;
    }
  }
}
