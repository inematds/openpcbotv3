// 3.12.6 — resumo de retomada: aos ~45 min parada a sessão ganha resumo (cache
// quente); depois de 55 min o bot não retoma, abre sessão nova com o resumo.
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { aplicarMigrations } from '../db/migrations.js';
import { Sessoes } from './agente-cli.js';
import { CACHE_SEG, resumirSessoesParadas, type Resumidor } from './resumo-sessao.js';

const CHAT = '42';
const MIN = 60;

function montar() {
  const db = new Database(':memory:');
  let t = 1_000_000;
  const relogio = { agora: () => t, avancar: (s: number) => { t += s; } };
  aplicarMigrations(db, () => t);
  const sessoes = new Sessoes(db, relogio.agora);
  const turno = (role: string, content: string) => db.prepare(
    'INSERT INTO conversation_log (chat_id, canal, role, content, session_id, agent_id, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
  ).run(CHAT, 'telegram', role, content, 'lead', t);
  return { db, sessoes, relogio, turno };
}

const resumidorFixo = (texto: string, chamadas: string[] = []): Resumidor => async (c) => { chamadas.push(c.session_id); return texto; };

describe('resumo de retomada', () => {
  it('antes de 40 min não resume; aos 45 min resume uma vez só', async () => {
    const { db, sessoes, relogio } = montar();
    sessoes.gravar(CHAT, 'lead', 's1');
    const chamadas: string[] = [];
    relogio.avancar(30 * MIN);
    expect(await resumirSessoesParadas(db, relogio.agora(), resumidorFixo('R', chamadas))).toBe('nada a resumir');
    relogio.avancar(15 * MIN);
    await resumirSessoesParadas(db, relogio.agora(), resumidorFixo('R', chamadas));
    relogio.avancar(1 * MIN);
    await resumirSessoesParadas(db, relogio.agora(), resumidorFixo('R', chamadas));
    expect(chamadas).toEqual(['s1']);
  });

  it('passou da janela (cache já vencido) não resume', async () => {
    const { db, sessoes, relogio } = montar();
    sessoes.gravar(CHAT, 'lead', 's1');
    relogio.avancar(58 * MIN);
    const chamadas: string[] = [];
    await resumirSessoesParadas(db, relogio.agora(), resumidorFixo('R', chamadas));
    expect(chamadas).toEqual([]);
  });

  it('chat com job de agente aberto não resume', async () => {
    const { db, sessoes, relogio } = montar();
    sessoes.gravar(CHAT, 'lead', 's1');
    db.prepare(`INSERT INTO jobs (fila, kind, tarefa, input, status, chat_id, criado_em, disponivel_em) VALUES ('agente','agent','agente:lead','{}','running', ?, ?, ?)`)
      .run(CHAT, relogio.agora(), relogio.agora());
    relogio.avancar(45 * MIN);
    const chamadas: string[] = [];
    await resumirSessoesParadas(db, relogio.agora(), resumidorFixo('R', chamadas));
    expect(chamadas).toEqual([]);
  });

  it('falha do resumidor não repete a cada minuto', async () => {
    const { db, sessoes, relogio } = montar();
    sessoes.gravar(CHAT, 'lead', 's1');
    relogio.avancar(45 * MIN);
    let n = 0;
    const falha: Resumidor = async () => { n += 1; throw new Error('x'); };
    expect(await resumirSessoesParadas(db, relogio.agora(), falha)).toMatch(/falhou/);
    relogio.avancar(MIN);
    await resumirSessoesParadas(db, relogio.agora(), falha);
    expect(n).toBe(1);
  });

  it('até 55 min retoma a sessão; depois abre nova com resumo e últimas mensagens', async () => {
    const { db, sessoes, relogio, turno } = montar();
    turno('user', 'faz o vídeo dos tornados');
    turno('assistant', 'Roteiro em ~/projetos/output/tornados/roteiro.md');
    sessoes.gravar(CHAT, 'lead', 's1');
    relogio.avancar(45 * MIN);
    await resumirSessoesParadas(db, relogio.agora(), resumidorFixo('Pedido: tornados PR/SC. Falta: avatar.'));
    relogio.avancar(5 * MIN);
    expect(sessoes.obter(CHAT, 'lead')).toBe('s1');
    expect(sessoes.retomada(CHAT, 'lead')).toBeUndefined();
    relogio.avancar(CACHE_SEG - 50 * MIN + 1);
    expect(sessoes.obter(CHAT, 'lead')).toBeUndefined();
    const b = sessoes.retomada(CHAT, 'lead')!;
    expect(b).toContain('sessão nova');
    expect(b).toContain('Pedido: tornados PR/SC. Falta: avatar.');
    expect(b).toContain('Nei: faz o vídeo dos tornados');
    expect(b).toContain('Bot: Roteiro em');
  });

  it('sem resumo (falhou) ainda leva as últimas mensagens', () => {
    const { sessoes, relogio, turno } = montar();
    turno('user', 'oi');
    sessoes.gravar(CHAT, 'lead', 's1');
    relogio.avancar(2 * 3600);
    const b = sessoes.retomada(CHAT, 'lead')!;
    expect(b).not.toContain('Resumo escrito');
    expect(b).toContain('Nei: oi');
  });

  it('resumo de sessão antiga não vaza para a sessão seguinte', async () => {
    const { db, sessoes, relogio } = montar();
    sessoes.gravar(CHAT, 'lead', 's1');
    relogio.avancar(45 * MIN);
    await resumirSessoesParadas(db, relogio.agora(), resumidorFixo('RESUMO-S1'));
    sessoes.gravar(CHAT, 'lead', 's2');
    relogio.avancar(2 * 3600);
    expect(sessoes.retomada(CHAT, 'lead') ?? '').not.toContain('RESUMO-S1');
  });

  it('/novo depois da sessão e pausa > 24 h: sem retomada', () => {
    const { sessoes, relogio, turno } = montar();
    turno('user', 'oi');
    sessoes.gravar(CHAT, 'lead', 's1');
    relogio.avancar(2 * 3600);
    sessoes.marcarNovo(CHAT);
    expect(sessoes.retomada(CHAT, 'lead')).toBeUndefined();
    const b = montar();
    b.turno('user', 'oi');
    b.sessoes.gravar(CHAT, 'lead', 's1');
    b.relogio.avancar(25 * 3600);
    expect(b.sessoes.retomada(CHAT, 'lead')).toBeUndefined();
  });
});
