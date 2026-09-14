// `/context [detail] [texto]` (openclaw token-use): quanto do prompt é cada
// camada, para a resposta direta (Ollama) e para um agente (claude -p). Só
// mede; não toca saliência, não grava turno, não chama modelo (embedding é a
// exceção: precisa dele para a camada vetorial ser a mesma da resposta real).
import type { App } from '../app.js';
import { aproxTokens, montarContextoMemoria } from '../cerebro/contexto.js';
import { identidade } from './agente-cli.js';
import { agentesCacheados } from './agentes.js';
import { blocoPersonalidade } from './personalidade.js';
import { blocoSkills, skillsCacheadas } from './skills.js';

export interface Camada { nome: string; tokens: number; itens?: string[] }
export interface MedicaoContexto { consulta: string; direto: Camada[]; agente: Camada[] }

const MAX_TURNOS = 8;

export async function medirContexto(app: App, chatId: string, texto?: string): Promise<MedicaoContexto> {
  const consulta = texto?.trim() || app.cerebro.ultimosTurnos(chatId, 1).find((t) => t.role === 'user')?.content || '';
  const memoria = await montarContextoMemoria(
    { cerebro: app.cerebro, gateway: app.gateway, modeloEmbed: app.ollama.modeloDe('embed'), tetoTokens: 600, somenteLeitura: true },
    chatId, consulta,
  );
  const hist = app.cerebro.ultimosTurnos(chatId, MAX_TURNOS);
  const persona = blocoPersonalidade(app.prefs, chatId);
  const usuario = app.vault.ler('USER.md', 800);
  const skills = blocoSkills(skillsCacheadas()).join('\n');
  const lead = agentesCacheados().find((a) => a.id === 'lead');

  const c = (nome: string, t: string, itens?: string[]): Camada => ({ nome, tokens: aproxTokens(t), itens });
  const linhasMem = memoria.split('\n').filter((l) => l.startsWith('- '));
  const direto: Camada[] = [
    c('identidade', identidade()),
    c('personalidade', persona),
    c('USER.md', usuario),
    c('memória+insights', memoria, linhasMem),
    c(`histórico (${hist.length} turnos)`, hist.map((h) => h.content).join('\n'), hist.map((h) => `${h.role}: ${h.content.slice(0, 60)}`)),
    c('mensagem', consulta),
  ];
  const agente: Camada[] = [
    c('identidade', identidade()),
    c('persona do agente', lead?.soul ?? ''),
    c('personalidade', persona),
    c('memória+insights', memoria),
    c(`skills (${skillsCacheadas().filter((s) => !s.rascunho).length}, só metadata)`, skills),
    c('regras', 'x'.repeat(220)),
    c('mensagem', consulta),
  ];
  return { consulta, direto, agente };
}

export function formatarMedicao(m: MedicaoContexto, detalhe: boolean): string {
  const bloco = (titulo: string, cs: Camada[]): string => {
    const total = cs.reduce((s, x) => s + x.tokens, 0);
    const linhas = cs.map((x) => `${String(x.tokens).padStart(5)}  ${x.nome}` + (detalhe && x.itens?.length ? `\n${x.itens.map((i) => `         · ${i}`).join('\n')}` : ''));
    return `*${titulo}* ≈ ${total} tokens fixos (+ resposta)\n\`\`\`\n${linhas.join('\n')}\n\`\`\``;
  };
  return `${bloco('Resposta direta (Ollama)', m.direto)}\n\n${bloco('Agente (claude -p, sem CLAUDE.md do cwd)', m.agente)}\n\nconsulta: "${m.consulta.slice(0, 80)}"${detalhe ? '' : '\n/context detail mostra os itens.'}`;
}
