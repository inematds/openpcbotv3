import { describe, expect, it } from 'vitest';
import { CodexRunner, argumentosCodex, esforcoCodex, mapaModelos } from './runner-codex.js';
import { interpretarSaidaCodex } from './saida-codex.js';
import { ambienteAssinatura } from './ambiente-assinatura.js';
import { RUNNERS } from './runner.js';

const ctx = (modelo = 'gpt-6.1-sol', esforco = 'medium') => ({
  prompt: 'faça X', cwd: '/tmp', perfil: { motor: 'codex', modelo, esforco }, vars: {},
});
const jsonl = (...events: object[]) => events.map(e => JSON.stringify(e)).join('\n');

describe('Codex por assinatura', () => {
  it('traduz apenas aliases configurados e exige modelo explícito', () => {
    expect(mapaModelos({ CODEX_MODELOS: 'sonnet=gpt-6.1-sol,lixo,=x,y=' })).toEqual({ sonnet: 'gpt-6.1-sol' });
    expect(argumentosCodex(ctx('sonnet'), { sonnet: 'gpt-6.1-sol' })).toContain('gpt-6.1-sol');
    expect(() => argumentosCodex(ctx('opus'), {})).toThrow(/explícito/);
    expect(argumentosCodex(ctx(), {})).toContain('gpt-6.1-sol');
    expect(argumentosCodex(ctx(), { 'gpt-6.1-sol': 'outro-modelo' })).toContain('gpt-6.1-sol');
  });
  it('não reduz esforço silenciosamente', () => {
    expect(esforcoCodex('xhigh')).toBe('xhigh');
    expect(() => esforcoCodex('max')).toThrow(/não suportado/);
  });
  it('fixa assinatura, sandbox, esforço e saída JSONL', () => {
    const a = argumentosCodex(ctx());
    expect(a[0]).toBe('exec');
    expect(a).toContain('--json');
    expect(a).toContain('sandbox_mode="danger-full-access"');
    expect(a).toContain('forced_login_method="chatgpt"');
    expect(a).toContain('model_reasoning_effort="medium"');
    expect(a).toContain('approval_policy="never"');
    expect(a.at(-1)).toBe('faça X');
  });
  it('retoma só o identificador fornecido, sem --last e com configurações explícitas', () => {
    const a = argumentosCodex({ ...ctx(), vars: { OPENPCBOT_SESSION: 'thread-1' } });
    expect(a.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(a.slice(-2)).toEqual(['thread-1', 'faça X']);
    expect(a).not.toContain('--last');
    expect(a).toContain('gpt-6.1-sol');
  });
  it('especialista usa sandbox de leitura e não herda MCPs pessoais', () => {
    const a = argumentosCodex({ ...ctx(), vars: { OPENPCBOT_SOMENTE_LEITURA: '1' } });
    expect(a).toContain('sandbox_mode="read-only"');
    expect(a).toContain('--ignore-user-config');
    expect(() => argumentosCodex({ ...ctx(), vars: { OPENPCBOT_MCP: '/nao/importar.json' } })).toThrow(/precisa ser adaptado/);
  });
  it('isola autenticação de modelo sem retirar credenciais de ferramentas', () => {
    const env = ambienteAssinatura('codex', { OPENAI_API_KEY: 'teste', ANTHROPIC_API_KEY: 'teste', OPENROUTER_API_KEY: 'teste', OPENAI_BASE_URL: 'x', TELEGRAM_BOT_TOKEN_V3: 'ferramenta', HOME: '/tmp' });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.TELEGRAM_BOT_TOKEN_V3).toBe('ferramenta');
  });
  it('retorna resposta final, sessão e tokens, sem logs de comandos ou raciocínio', () => {
    const s = interpretarSaidaCodex(jsonl(
      { type: 'thread.started', thread_id: 't1' },
      { type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'NAO ENTREGAR' } },
      { type: 'item.completed', item: { type: 'reasoning', text: 'NAO ENTREGAR' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'feito' } },
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 2 } },
    ));
    expect(s).toEqual({ texto: 'feito', sessionId: 't1', tokensIn: 10, tokensOut: 5, tokensCache: 2 });
  });
  it('recusa falha de cota, resposta ausente e saída truncada', () => {
    expect(() => interpretarSaidaCodex(jsonl({ type: 'turn.failed', error: { message: 'usage limit reached' } }))).toThrow(/usage limit/);
    expect(() => interpretarSaidaCodex(jsonl({ type: 'turn.completed' }))).toThrow(/sem resposta/);
    expect(() => interpretarSaidaCodex('{quebrado')).toThrow(/inválida/);
    expect(() => interpretarSaidaCodex(jsonl({ type: 'item.completed', item: { type: 'agent_message', text: 'parcial' } }))).toThrow(/incompleta/);
  });
  it('registra o executor e preserva o Claude', () => {
    expect(RUNNERS.codex).toBeInstanceOf(CodexRunner);
    expect(RUNNERS.claude?.nome).toBe('claude');
  });
  it('herda execução por subprocesso sem shell', async () => {
    const saida = await new CodexRunner('/bin/echo').iniciar({ ...ctx(), prompt: 'literal $(echo nao-executar)' }).aguardar();
    expect(saida).toContain('literal $(echo nao-executar)');
  });
});
