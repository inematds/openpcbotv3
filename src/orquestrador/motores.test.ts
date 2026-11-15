import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { aplicarMigrations, MIGRATIONS } from '../db/migrations.js';
import { Prefs } from '../config/prefs.js';
import { CHAVE_MOTOR, perfilAgente } from '../config/agentes-ia.js';
import { FilaSqlite } from '../fila/store.js';
import { criarPromptDe, Sessoes } from './agente-cli.js';
import { executarComando } from './comandos.js';
import { resumirSessoesParadas } from './resumo-sessao.js';
import type { App } from '../app.js';
import type { MensagemRecebida } from '../bus/bus.js';

function montar() {
  const db = new Database(':memory:');
  let t = 10000;
  const agora = () => t;
  aplicarMigrations(db, agora);
  const prefs = new Prefs(db, agora), sessoes = new Sessoes(db, agora), fila = new FilaSqlite(db, agora);
  const app = { db, prefs, sessoes, fila, agora, cerebro: { logarTurno: () => {} } } as unknown as App;
  const entrada = { chatId: '42', canal: 'http', agente: 'lead', texto: 'continuar' };
  const criar = () => fila.enfileirar({ fila: 'agente', kind: 'agent', tarefa: 'agente:lead', input: JSON.stringify(entrada), flow_ref: 'http:42', max_tentativas: 1 });
  const turno = (texto: string) => db.prepare("INSERT INTO conversation_log (chat_id, canal, role, content, created_at) VALUES ('42', 'http', 'assistant', ?, ?)").run(texto, t);
  const prompt = criarPromptDe({ sessoes, claudeBin: 'claude', perfilDe: e => perfilAgente(prefs, e.chatId, { modelo: 'sonnet', esforco: 'low' }) });
  return { db, prefs, sessoes, fila, app, entrada, criar, turno, prompt, agora, avancar: (s: number) => { t += s; } };
}
const msg = (texto: string): MensagemRecebida => ({ canal: 'http', chatId: '42', texto, recebidaEm: 1, traceId: 'teste' });

describe('agentes com motores separados', () => {
  it('migra sessões legadas para Claude sem perder resumo; é idempotente', () => {
    const db = new Database(':memory:');
    aplicarMigrations(db, () => 1, MIGRATIONS.filter(m => m.version < 12));
    db.prepare("INSERT INTO sessions (chat_id, agente, session_id, ultimo_uso, resumo) VALUES ('42','lead','antiga',1,'resumo')").run();
    expect(aplicarMigrations(db, () => 2)).toBe(1);
    expect(db.prepare('SELECT motor, session_id, resumo FROM sessions').get()).toEqual({ motor: 'claude', session_id: 'antiga', resumo: 'resumo' });
    expect(aplicarMigrations(db, () => 3)).toBe(0);
  });
  it('/motor persiste no chat, não aceita API e não interfere em outro chat', async () => {
    const x = montar();
    expect(await executarComando(x.app, msg('/motor claude'))).toContain('claude pela assinatura');
    expect(x.prefs.obter('42', CHAVE_MOTOR)).toBe('claude');
    expect(perfilAgente(x.prefs, '99', { modelo: 'sonnet', esforco: 'low' }).motor).toBe('codex');
    expect(await executarComando(x.app, msg('/motor anthropic'))).toContain('Uso:');
    await executarComando(x.app, msg('/motor padrao'));
    expect(x.prefs.obter('42', CHAVE_MOTOR)).toBeUndefined();
  });
  it('perfil fixado no job sobrevive a uma mudança de preferência', async () => {
    const x = montar(), j = x.criar();
    expect((await x.prompt(j)).perfil.motor).toBe('codex');
    x.prefs.gravar('42', CHAVE_MOTOR, 'claude');
    expect((await x.prompt(j)).perfil.motor).toBe('codex');
    expect((await x.prompt(x.criar())).perfil.motor).toBe('claude');
  });
  it('nunca envia sessão Claude ao Codex nem retoma uma sessão anterior à troca', () => {
    const x = montar();
    x.sessoes.gravar('42', 'lead', 'c1');
    x.avancar(1);
    expect(x.sessoes.obter('42', 'lead', x.agora(), 'codex')).toBeUndefined();
    x.sessoes.gravar('42', 'lead', 'x1', x.agora(), 'codex');
    expect(x.sessoes.obter('42', 'lead', x.agora(), 'claude')).toBeUndefined();
    expect(x.sessoes.obter('42', 'lead', x.agora(), 'codex')).toBe('x1');
    expect(x.db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 2 });
  });
  it('nova sessão Codex recebe histórico e salva seu próprio identificador', async () => {
    const x = montar();
    x.turno('Arquivo pronto: /tmp/exemplo.txt; falta conferir.');
    x.sessoes.gravar('42', 'lead', 'claude-antiga');
    x.avancar(1);
    const j = x.criar(), c = await x.prompt(j);
    expect(c.vars.OPENPCBOT_SESSION).toBeUndefined();
    expect(c.prompt).toContain('/tmp/exemplo.txt');
    c.interpretarSaida!([
      { type: 'thread.started', thread_id: 'codex-nova' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'conferido' } },
      { type: 'turn.completed' },
    ].map(e => JSON.stringify(e)).join('\n'));
    expect(x.sessoes.obter('42', 'lead', x.agora(), 'codex')).toBe('codex-nova');
    const proximo = await x.prompt(x.criar());
    expect(proximo.vars.OPENPCBOT_SESSION).toBe('codex-nova');
    expect(proximo.vigia).toBeUndefined(); // nunca vigiar o transcript Claude
  });
  it('/novo invalida sessões dos dois motores e não leva histórico anterior', () => {
    const x = montar();
    x.turno('ANTERIOR');
    x.sessoes.gravar('42', 'lead', 'x1', x.agora(), 'codex');
    x.avancar(2); x.sessoes.marcarNovo('42'); x.avancar(2);
    expect(x.sessoes.obter('42', 'lead', x.agora(), 'codex')).toBeUndefined();
    expect(x.sessoes.contextoNovo('42', 'lead', x.agora())).toBeUndefined();
  });
  it('/job segue o motor selecionado e não reutiliza id de outro motor', async () => {
    const x = montar(), pai = x.criar();
    x.sessoes.fixarPerfil(pai.id, { motor: 'claude', modelo: 'sonnet', esforco: 'low' });
    x.sessoes.gravarDoJob(pai.id, 'c1');
    await executarComando(x.app, msg(`/job ${pai.id} confira o arquivo`));
    const filho = x.fila.listar({ fila: 'agente' }).at(-1)!;
    expect(filho.motor).toBe('codex');
    expect((await x.prompt(filho)).vars.OPENPCBOT_SESSION).toBeUndefined();
  });
  it('resumidor Claude não recebe sessões Codex nem altera seus resumos', async () => {
    const x = montar();
    x.sessoes.gravar('42', 'lead', 'c1');
    x.sessoes.gravar('42', 'lead', 'x1', x.agora(), 'codex');
    x.avancar(45 * 60);
    const ids: string[] = [];
    await resumirSessoesParadas(x.db, x.agora(), async c => { ids.push(c.session_id); return 'resumo'; });
    expect(ids).toEqual(['c1']);
    expect(x.db.prepare("SELECT resumo_de FROM sessions WHERE motor = 'codex'").get()).toEqual({ resumo_de: null });
  });
  it('especialista recebe restrição de leitura mesmo sem flag no pedido', async () => {
    const x = montar(), j = x.criar();
    j.input = JSON.stringify({ ...x.entrada, agente: 'research' });
    expect((await x.prompt(j)).vars.OPENPCBOT_SOMENTE_LEITURA).toBe('1');
  });
});
