import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { coletarCreditos, descobrirContasClaude, diasAte, emailCodex, rotuloConta } from './fontes/creditos.js';
import { caminhosPadrao, type DepsPainel } from './tipos.js';
import { Cache, type Executor } from './util.js';

const AGORA = Math.floor(new Date('2026-11-20T23:00:00').getTime() / 1000);
const semExec: Executor = async () => ({ ok: false, stdout: '', stderr: '', codigo: null, erro: 'ausente' });
const uid = process.getuid?.() ?? 1000;
const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;

describe('cotas por conta', () => {
  it('diasAte conta dias de calendário até o reset', () => {
    expect(diasAte(null, AGORA)).toBeNull();
    expect(diasAte(AGORA + 3600, AGORA)).toBe(1); // 23:00 + 1 h = amanhã 00:00
    expect(diasAte(AGORA - 7200, AGORA)).toBe(0);
    expect(diasAte(Math.floor(new Date('2026-11-26T11:00:00').getTime() / 1000), AGORA)).toBe(6);
  });

  it('rotuloConta encurta o e-mail e usa a reserva sem e-mail', () => {
    expect(rotuloConta('nei.maldaner2014@gmail.com', 'x')).toBe('nei');
    expect(rotuloConta('inematds@gmail.com', 'x')).toBe('inematds');
    expect(rotuloConta(null, 'padrão')).toBe('padrão');
  });

  it('emailCodex lê só o payload do id_token e aguenta lixo', () => {
    expect(emailCodex({ tokens: { id_token: jwt({ email: 'a@b.c' }) } })).toBe('a@b.c');
    expect(emailCodex({ tokens: { id_token: 'quebrado' } })).toBeNull();
    expect(emailCodex(null)).toBeNull();
  });

  it('descobrirContasClaude acha um cache por pasta de login e ignora o resto', () => {
    const t = mkdtempSync(join(tmpdir(), 'cotas-'));
    for (const n of [`cc_limits_${uid}.json`, `cc_limits_${uid}_.claude-inematds.json`, `cc_limits_${uid + 1}.json`, 'cc_usage_1000.txt'])
      writeFileSync(join(t, n), '{}');
    const r = descobrirContasClaude(t, uid, '/home/x');
    expect(r.map((c) => c.cfg)).toEqual(['/home/x/.claude.json', '/home/x/.claude-inematds/.claude.json']);
    expect(r.map((c) => c.reserva)).toEqual(['padrão', 'inematds']);
  });

  it('coletarCreditos lista as duas contas do Claude e a do Codex com os dias', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cotas-home-'));
    const tmp = mkdtempSync(join(tmpdir(), 'cotas-tmp-'));
    const reset = new Date('2026-11-26T11:00:00').toISOString();
    const lim = (p: number) => JSON.stringify({ limits: [{ kind: 'weekly_all', percent: p, resets_at: reset }, { kind: 'session', percent: 10, resets_at: reset }] });
    writeFileSync(join(tmp, `cc_limits_${uid}.json`), lim(30));
    writeFileSync(join(tmp, `cc_limits_${uid}_.claude-inematds.json`), lim(4));
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'nei.maldaner2014@x.com' } }));
    mkdirSync(join(home, '.claude-inematds'));
    writeFileSync(join(home, '.claude-inematds', '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'inematds@x.com' } }));
    const cx = join(home, '.codex', 'sessions', '2026', '11', '20');
    mkdirSync(cx, { recursive: true });
    writeFileSync(join(cx, 's.jsonl'), JSON.stringify({ payload: { rate_limits: { primary: { used_percent: 12, window_minutes: 300, resets_at: AGORA + 1800 }, plan_type: 'pro' } } }) + '\n');
    writeFileSync(join(home, '.codex', 'auth.json'), JSON.stringify({ tokens: { id_token: jwt({ email: 'nei.maldaner2014@x.com' }) } }));
    const caminhos = caminhosPadrao(home, home);
    caminhos.ccLimites = join(tmp, `cc_limits_${uid}.json`);
    caminhos.ccLimitesPasta = tmp;
    const d = { versao: 't', caminhos, exec: semExec, agora: () => AGORA, cache: new Cache(), concorrenciaV3: {}, fetch: fetch, sitesLigado: false } as unknown as DepsPainel;
    const { dados } = await coletarCreditos(d);
    expect(dados.contas.map((c) => `${c.servico} ${c.conta}`)).toEqual(['Claude nei', 'Claude inematds', 'Codex nei']);
    expect(dados.contas[0].limites[0]).toMatchObject({ nome: 'Semana (todos)', pct: 30, dias: 6 });
    expect(dados.contas[2].limites[0]).toMatchObject({ nome: 'Janela de 5 h', pct: 12, dias: 0 });
    expect(dados.contas[2].plano).toBe('pro');
    expect(dados.claude.limites[0].pct).toBe(30); // campo antigo continua
  });
});
