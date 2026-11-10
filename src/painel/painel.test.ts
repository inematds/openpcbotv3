import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';

import { montarPainel } from './agregador.js';
import { avaliarAlertas, type GruposColetados } from './alertas.js';
import { abrirSomenteLeitura, fecharAccbot, lerAccbot } from './fontes/bots.js';
import { extrairRateLimits, lerAvisos } from './fontes/creditos.js';
import { lerBoots } from './fontes/maquina.js';
import { montarRodadas } from './fontes/producao.js';
import { lerHistorico, resumirFila } from './fontes/publicacao.js';
import { lerPendencias } from './fontes/terminais.js';
import { montarClasses, mudarVagas } from './fontes/vagas.js';
import { servidorPainel } from './http-painel.js';
import { PAINEL_HTML, PAINEL_JS } from './tela/pagina.js';
import { caminhosPadrao, type DepsPainel } from './tipos.js';
import { Cache, type Executor } from './util.js';

const AGORA = Math.floor(new Date('2026-11-09T20:00:00').getTime() / 1000);
const vazio = mkdtempSync(join(tmpdir(), 'painel-vazio-'));
const semExec: Executor = async () => ({ ok: false, stdout: '', stderr: '', codigo: null, erro: 'ausente' });

function deps(p: Partial<DepsPainel> = {}): DepsPainel {
  const caminhos = caminhosPadrao(vazio, vazio);
  caminhos.ccLimites = join(vazio, 'cc_limits.json');
  return {
    versao: '0.0.0-teste', caminhos, exec: semExec, agora: () => AGORA, cache: new Cache(),
    concorrenciaV3: { chat: 2 }, fetch: (async () => { throw new Error('sem rede no teste'); }) as unknown as typeof fetch,
    sitesLigado: false, ...p,
  };
}

afterAll(() => fecharAccbot());

describe('agregador', () => {
  it('com TODAS as fontes ausentes não quebra e não inventa alerta de fonte ausente', async () => {
    const p = await montarPainel(deps());
    expect(Object.keys(p.grupos).sort()).toEqual(['bots', 'creditos', 'esperando', 'maquina', 'producao', 'publicacao', 'sites', 'terminais', 'vagas']);
    for (const g of Object.values(p.grupos)) { expect(g.ok).toBe(true); expect(typeof g.gerado_em).toBe('number'); }
    expect(p.grupos.bots.ausentes).toContain('inemaccbot.db');
    expect(p.grupos.producao.ausentes).toContain('rodadas.jsonl');
    expect(p.grupos.vagas.ausentes).toContain('vagas.json');
    const deFonteAusente = p.alertas.filter((a) => ['bots', 'producao', 'publicacao', 'sites', 'terminais', 'creditos'].includes(a.grupo));
    expect(deFonteAusente).toEqual([]);
    expect(p.grupos.vagas.dados?.pode_mudar).toBe(false);
  });
});

describe('parser tolerante do histórico do yt-pubx', () => {
  it('ignora linha quebrada e aceita registro sem campos', () => {
    const t = [
      '{"data": "2026-11-09T10:00:00", "canal": "lives4", "video_id": "LPlTSX-7R84", "titulo": "A", "privacy": {"privacyStatus": "public"}, "thumb_ok": true}',
      'lixo{{{',
      '{"data": "2026-11-08T09:00:00", "url": "https://youtube.com/shorts/cgZSgxjXaWs"}',
      '{"canal": "lives1"}',
      '{"data": "2026-11-09T11:00:00", "canal": "lives3", "video_id": "id-ruim\\"><script>", "titulo": "B"}',
      '{"data": "2026-11-0',
    ].join('\n');
    const u = lerHistorico(t);
    expect(u.map((x) => x.titulo)).toEqual(['B', 'A', '']);
    expect(u[1].miniatura).toBe('https://i.ytimg.com/vi/LPlTSX-7R84/mqdefault.jpg');
    expect(u[2].video_id).toBe('cgZSgxjXaWs');
    expect(u[2].canal).toBe('?');
    expect(u[0].video_id).toBeNull();
    expect(u[0].miniatura).toBeNull();
  });

  it('fila: erro antigo só conta, erro recente vira erro_recente', () => {
    const r = resumirFila('r7ex', [
      { id: 'a', estado: 'erro', quando: '2026-10-01T08:00' }, { id: 'b', estado: 'erro', quando: '2026-11-09T08:00', nome: 'novo' },
      { id: 'c', estado: 'pendente', nome: 'próximo' }, { id: 'd', estado: 'feito' },
    ], AGORA);
    expect(r?.por_estado).toEqual({ erro: 2, pendente: 1, feito: 1 });
    expect(r?.erros_recentes.map((e) => e.id)).toEqual(['b']);
    expect(r?.proximo).toBe('próximo');
    expect(resumirFila('x', 'não é lista', AGORA)).toBeNull();
  });
});

describe('rodadas', () => {
  it('junta início/fim, marca presa > 90 min e falhou', () => {
    const r = montarRodadas([
      { ts: '2026-11-09T08:00:00', unidade: 'clima', fase: 'inicio', edicao: 'e1' },
      { ts: '2026-11-09T08:05:00', unidade: 'clima', fase: 'fim', edicao: 'e1', resultado: 'publicado', dur_s: 300 },
      { ts: '2026-11-09T17:00:00', unidade: 'finviral', fase: 'inicio' },
      { ts: '2026-11-09T19:40:00', unidade: 'r7ex', fase: 'inicio' },
      { ts: '2026-11-09T12:00:00', unidade: 'saude', fase: 'fim', resultado: 'falhou', motivo: 'sem pauta' },
      { unidade: 'sem-ts', fase: 'inicio' },
    ], AGORA);
    const por = Object.fromEntries(r.map((x) => [x.unidade, x]));
    expect(por.clima.dur_s).toBe(300);
    expect(por.clima.presa).toBe(false);
    expect(por.finviral.presa).toBe(true);
    expect(por.r7ex.presa).toBe(false);
    expect(por.saude.resultado).toBe('falhou');
    expect(por['sem-ts']).toBeUndefined();
  });
});

function gruposBase(): GruposColetados {
  const g = (dados: unknown) => ({ ok: true, gerado_em: AGORA, dados }) as never;
  return {
    maquina: g({ memoria: { total_gb: 119, disponivel_gb: 50, swap_usado_gb: 0 }, carga: null, disco: { total_gb: 4000, livre_gb: 800, usado_pct: 80 }, boot_em: AGORA - 86400, reinicios: { em: [] }, gpu_oom: { ultimas_24h: 3, ultima_hora: 0, ultima_em: AGORA - 7200 } }),
    bots: g({ v3: { falhas_24h: [] }, inemaccbot: { falhas_24h: [] }, servicos: { openpcbotv3: 'active', inemaccbot: 'active', openpcbot: 'desconhecido' } }),
    producao: g({ hoje: [], presas: [], falhas: [], esperas: [], timers: [] }),
    publicacao: g({ filas: [] }),
    creditos: g({ claude: { limites: [{ nome: 'Semana (todos)', pct: 50, reset_em: null }] }, codex: null, custo_hoje: [], avisos: [] }),
    sites: g({ sites: [{ url: 'https://inema.club', ok: true }] }),
    terminais: g({ vivos: [], interrompidos: [] }),
  };
}

describe('regras de alerta', () => {
  it('tudo normal = nenhum alerta (GPU antiga, serviço desconhecido e limite 50% não alertam)', () => {
    expect(avaliarAlertas(gruposBase(), AGORA)).toEqual([]);
  });

  it('cada limite dispara com chave estável', () => {
    const g = gruposBase() as unknown as Record<string, { dados: Record<string, unknown> }>;
    Object.assign(g.maquina.dados, { disco: { usado_pct: 93, livre_gb: 289 }, memoria: { disponivel_gb: 8, total_gb: 119 }, boot_em: AGORA - 3600, gpu_oom: { ultimas_24h: 5, ultima_hora: 2, ultima_em: AGORA - 60 } });
    g.bots.dados.servicos = { openpcbotv3: 'active', inemaccbot: 'inactive' };
    g.bots.dados.v3 = { falhas_24h: [{ id: 7, tarefa: 'cli', fila: 'agente', quando: AGORA - 60, erro: 'x' }] };
    g.producao.dados.presas = [{ unidade: 'finviral', inicio: AGORA - 6000, presa: true, aberta_min: 100 }];
    g.producao.dados.falhas = [{ unidade: 'clima', edicao: 'e9', fim: AGORA - 100, resultado: 'falhou' }];
    g.publicacao.dados.filas = [{ nome: 'r7ex', erros_recentes: [{ id: 'z', nome: 'Z', erro: 'e' }] }];
    g.sites.dados.sites = [{ url: 'https://inema.vip', ok: false, erro: 'HTTP 502' }];
    g.creditos.dados.claude = { limites: [{ nome: 'Semana (todos)', pct: 85 }] };
    g.creditos.dados.avisos = lerAvisos([{ titulo: 'OAuth YouTube: conferir', ate: '2026-11-11' }], AGORA);
    g.terminais.dados.interrompidos = [{ session_id: 's1', projeto: 'wifi' }];
    const chaves = avaliarAlertas(g as unknown as GruposColetados, AGORA).map((a) => a.chave).sort();
    expect(chaves).toEqual([
      'disco:raiz', 'fila-erro:r7ex:z', 'gpu:oom', 'job-falhou:v3:7', 'limite-claude:Semana (todos)', 'manual:OAuth YouTube: conferir',
      'memoria:baixa', `reinicio:${AGORA - 3600}`, 'rodada-falhou:clima:e9', `rodada-presa:finviral:${AGORA - 6000}`, 'servico:inemaccbot',
      'site-fora:inema.vip', 'terminal-interrompido:s1',
    ].sort());
    // Chave sem número que varia: a mesma condição com outro valor dá a mesma chave.
    (g.maquina.dados.disco as { usado_pct: number }).usado_pct = 95;
    expect(avaliarAlertas(g as unknown as GruposColetados, AGORA).filter((a) => a.chave === 'disco:raiz')).toHaveLength(1);
  });

  it('prazo manual conta dias de calendário', () => {
    const [a] = lerAvisos([{ titulo: 'x', ate: '2026-11-11' }], AGORA);
    expect(a.dias).toBe(2);
    expect(a.vencido).toBe(false);
    expect(lerAvisos([{ titulo: 'y', ate: '2026-11-01' }], AGORA)[0].vencido).toBe(true);
  });
});

describe('POST /api/vagas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'painel-vagas-'));
  const vj = join(dir, 'vagas.json');
  writeFileSync(vj, JSON.stringify({ gpu: 1, render: 2, _teto: { gpu: 2, render: 4 } }));
  const script = join(dir, 'vagas');
  writeFileSync(script, '#!/bin/sh\necho ok\n');
  const chamadas: string[][] = [];
  const exec: Executor = async (cmd, args) => { chamadas.push([cmd, ...args]); return { ok: true, stdout: 'gravado', stderr: '', codigo: 0 }; };
  const base = (token?: string) => { const d = deps({ exec, token }); d.caminhos.vagasJson = vj; d.caminhos.scriptVagas = script; return d; };

  it('sem token definido → 403', async () => {
    const r = await mudarVagas(base(undefined), 'Bearer qualquer', '{"classe":"gpu","valor":1}');
    expect(r.status).toBe(403);
  });
  it('token só por ?token= (sem Bearer) → 401', async () => {
    expect((await mudarVagas(base('t0k'), undefined, '{"classe":"gpu","valor":1}')).status).toBe(401);
  });
  it('acima do teto → 400; JSON inválido, valor 0, fracionário e _teto → 400', async () => {
    const d = base('t0k');
    expect((await mudarVagas(d, 'Bearer t0k', '{"classe":"gpu","valor":3}')).status).toBe(400);
    expect((await mudarVagas(d, 'Bearer t0k', '{nao json')).status).toBe(400);
    expect((await mudarVagas(d, 'Bearer t0k', '{"classe":"gpu","valor":0}')).status).toBe(400);
    expect((await mudarVagas(d, 'Bearer t0k', '{"classe":"gpu","valor":1.5}')).status).toBe(400);
    expect((await mudarVagas(d, 'Bearer t0k', '{"classe":"_teto","valor":1}')).status).toBe(400);
    expect((await mudarVagas(d, 'Bearer t0k', '{"classe":"toString","valor":1}')).status).toBe(400);
    expect(chamadas).toEqual([]);
  });
  it('válido → chama `vagas <classe> <n>` sem shell e avisa gpu > 1', async () => {
    const r = await mudarVagas(base('t0k'), 'Bearer t0k', '{"classe":"gpu","valor":2}');
    expect(r.status).toBe(200);
    expect(r.corpo.aviso).toMatch(/estável com 1/);
    expect(chamadas).toEqual([[script, 'gpu', '2']]);
  });
  it('pela rota HTTP: GET → 405, POST sem token → 403', async () => {
    const srv = servidorPainel(base(undefined));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const porta = (srv.address() as AddressInfo).port;
    const g = await fetch(`http://127.0.0.1:${porta}/api/vagas`);
    const p = await fetch(`http://127.0.0.1:${porta}/api/vagas`, { method: 'POST', body: '{"classe":"gpu","valor":1}' });
    const h = await fetch(`http://127.0.0.1:${porta}/painel`);
    await new Promise((r) => srv.close(r));
    expect(g.status).toBe(405);
    expect(p.status).toBe(403);
    expect(h.status).toBe(200);
  });
  it('status do fila-vaga no formato {classes:{gpu:{…}}}', () => {
    const c = montarClasses({ classes: { gpu: { vagas: 1, teto: 2, ocupadas: 1, esperando: 0, donos: [{ vaga: 1, quem: 'r7ex', desde: 'x' }] } } }, { gpu: 1, _teto: { gpu: 2 } });
    expect(c).toEqual([{ classe: 'gpu', vagas: 1, teto: 2, ocupadas: 1, dono: 'r7ex', desde: 'x', esperando: 0 }]);
  });
});

describe('inemaccbot.db', () => {
  it('aberto SÓ leitura: escrita falha e arquivo inexistente não é criado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'painel-accbot-'));
    const arq = join(dir, 'inemaccbot.db');
    const w = new Database(arq);
    w.exec("CREATE TABLE jobs (id INTEGER PRIMARY KEY, fila TEXT, tarefa TEXT, status TEXT, erro TEXT, criado_em INTEGER, terminado_em INTEGER); INSERT INTO jobs VALUES (1,'render','reel','failed','boom'," + (AGORA - 60) + ",NULL)");
    w.close();
    const db = abrirSomenteLeitura(arq);
    expect(db.readonly).toBe(true);
    expect(() => db.exec("INSERT INTO jobs (fila) VALUES ('x')")).toThrow(/readonly/i);
    db.close();
    expect(() => abrirSomenteLeitura(join(dir, 'nao-existe.db'))).toThrow();
    const r = lerAccbot(arq, AGORA);
    expect(r.falhas_24h.map((f) => f.id)).toEqual([1]);
    expect(r.fluxos_abertos).toEqual([]);
  });
});

describe('pequenos parsers e a tela', () => {
  it('boots em JSON, rate_limits do Codex, pendências', () => {
    expect(lerBoots('[{"first_entry":1794250590000000},{"first_entry":1794276000000000}]')).toEqual([1794250590, 1794276000]);
    const rl = extrairRateLimits('xx{"payload":{"rate_limits":{"primary":{"used_percent":18.0,"resets_at":1794405623},"plan_type":"p"}}}\n');
    expect((rl?.primary as { used_percent: number }).used_percent).toBe(18);
    expect(extrairRateLimits('nada')).toBeNull();
    const p = lerPendencias('# x\n## Abertas\n- **Um**: a\n  - [ ] sub\n### Dois\n- **Três**\n## Resolvidas\n- **Velha**\n');
    expect(p?.map((x) => x.titulo)).toEqual(['Um', 'Dois', 'Três']);
    expect(lerPendencias(null)).toBeNull();
  });
  it('JS do cliente compila e o HTML tem os 9 grupos', () => {
    expect(() => new Function(PAINEL_JS)).not.toThrow();
    expect(PAINEL_JS).not.toMatch(/token=/);
    for (const g of ['esperando', 'maquina', 'bots', 'producao', 'publicacao', 'creditos', 'sites', 'vagas', 'terminais']) expect(PAINEL_HTML).toContain(`id="t-${g}"`);
  });
});
