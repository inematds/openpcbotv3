// Codex CLI pela assinatura. JSONL permite separar resposta, sessão e uso.
import { ehNivel, nivel } from '../config/modelos.js';
import { ClaudeRunner } from './runner-claude.js';
import { RUNNERS, type ContextoExecucao } from './runner.js';

export function mapaModelos(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const bruto = env.CODEX_MODELOS?.trim();
  if (!bruto) return {};
  const mapa: Record<string, string> = {};
  for (const par of bruto.split(',')) {
    const [alias, id] = par.split('=').map((s) => s.trim());
    if (alias && id) mapa[alias] = id;
  }
  return mapa;
}


export function esforcoCodex(esforco: string): string {
  if (!['minimal', 'low', 'medium', 'high', 'xhigh'].includes(esforco)) {
    throw new Error(`Codex: esforço não suportado: ${esforco}`);
  }
  return esforco;
}

export function argumentosCodex(ctx: ContextoExecucao, mapa = mapaModelos()): string[] {
  const alias = ctx.perfil.modelo;
  const modelo = /^gpt-[\w.-]+$/.test(alias) ? alias : mapa[alias] ?? (ehNivel(alias) ? nivel('codex', alias).modelo : undefined);
  if (!modelo) throw new Error(`Codex: configure um modelo explícito para ${alias}`);
  const vars = ctx.vars ?? {};
  if (vars.OPENPCBOT_MCP) throw new Error('Codex: MCP específico do Claude precisa ser adaptado antes de executar este agente');
  const sessao = vars.OPENPCBOT_SESSION;
  const leitura = vars.OPENPCBOT_SOMENTE_LEITURA === '1';
  return [
    'exec', ...(sessao ? ['resume'] : []),
    '--skip-git-repo-check', '--json',
    '-c', `sandbox_mode="${leitura ? 'read-only' : 'danger-full-access'}"`,
    '-c', 'approval_policy="never"',
    '-c', 'forced_login_method="chatgpt"',
    '-c', 'model_provider="openai"',
    // Especialistas não herdam MCPs com escrita do perfil pessoal.
    ...(leitura ? ['--ignore-user-config'] : []),
    '--model', modelo,
    '-c', `model_reasoning_effort="${esforcoCodex(ctx.perfil.esforco)}"`,
    ...(sessao ? [sessao] : []), ctx.prompt,
  ];
}

export class CodexRunner extends ClaudeRunner {
  nome = 'codex';
  constructor(binario = 'codex', memoriaMax?: string) {
    super({ binario, memoriaMax, montarArgs: argumentosCodex });
  }
}
RUNNERS.codex = new CodexRunner();
