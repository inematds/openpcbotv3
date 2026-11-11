// Os desenhos do cliente com dados de verdade (rodada presa, rodada que falhou,
// falha de job, uploads, terminais) nos três modos — sem navegador.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { servidorPainel } from './http-painel.js';
import { JS_AJUDA } from './tela/script-base.js';
import { JS_GRUPOS } from './tela/script-grupos.js';
import { caminhosPadrao, type DepsPainel } from './tipos.js';
import { Cache } from './util.js';

type Desenho = { tile: (d: unknown, g: unknown) => { frase: string; corpo: string }; detalhe: (d: unknown, g: unknown) => string };
const cliente = new Function(`${JS_AJUDA}\nvar NOMES={producao:'Produção',bots:'Bots'};function tok(){return'x'}\n${JS_GRUPOS}\nreturn {G:G,E:E};`)() as { G: Record<string, Desenho>; E: { modo: string } };

const T = Math.floor(Date.now() / 1000);
const DADOS: Record<string, unknown> = {
  maquina: { memoria: { total_gb: 119, disponivel_gb: 9, swap_usado_gb: 1 }, carga: { m1: 3, m5: 2, m15: 1, nucleos: 20 }, disco: { total_gb: 4000, livre_gb: 280, usado_pct: 93 }, boot_em: T - 3600, reinicios: { em: [T - 3600] }, gpu_oom: { ultimas_24h: 2, ultima_hora: 1, ultima_em: T - 60 } },
  bots: { v3: { jobs: { por_estado_recente: { done: 3, failed: 1 }, rodando: 1, na_fila: 2, criados_hoje: 9 }, falhas_24h: [{ id: 5, tarefa: 'cli<b>', fila: 'agente', quando: T - 60, erro: 'boom "x"' }], sessoes_1h: 1, custo_hoje: { chamadas: 2, usd: 0.5 }, cron: [{ nome: 'c', proxima_em: T + 60 }] },
    inemaccbot: { jobs: { rodando: 0, na_fila: 0 }, falhas_24h: [], fluxos_abertos: [{ id: 1, tipo: 'r7ex', slug: 's', status: 'rodando' }], aguardando_ok: [{ fluxo_id: 1, fase: 'ficha', slug: 's' }] }, servicos: { openpcbotv3: 'active', inemaccbot: 'failed' } },
  producao: { hoje: [{ unidade: 'clima', edicao: 'e', inicio: T - 900, fim: T - 600, resultado: 'falhou', motivo: 'm', dur_s: 300, presa: false, aberta_min: null }, { unidade: 'r7ex', inicio: T - 60, fim: null, resultado: null, presa: false, aberta_min: 1 }],
    presas: [{ unidade: 'finviral', inicio: T - 6000, fim: null, resultado: null, presa: true, aberta_min: 100 }], falhas: [], esperas: [{ chave: 'k', estado: 'esperando', desde: T - 60, teto_h: 8, passou_teto: false }], timers: [{ unidade: 'continua', proxima: T + 60, ultima: T - 60 }] },
  publicacao: { hoje: 1, hoje_por_canal: { lives3: 1 }, semana_por_canal: { lives3: 4, lives1: 2 }, ultimos: [{ quando: T - 60, canal: 'lives3', video_id: 'LPlTSX-7R84', url: 'https://www.youtube.com/watch?v=LPlTSX-7R84', titulo: 'T', miniatura: 'https://i.ytimg.com/vi/LPlTSX-7R84/mqdefault.jpg' }],
    filas: [{ nome: 'r7ex', total: 3, por_estado: { pendente: 1, erro: 1 }, erros_recentes: [{ id: 'z', nome: 'Z', erro: 'e' }], proximo: 'p' }] },
  creditos: { claude: { limites: [{ nome: 'Semana (todos)', pct: 85, reset_em: T + 3600 }], idade_s: 60 }, codex: { pct: 18, reset_em: T + 9, janela_h: 168, plano: 'p', idade_s: 9 }, custo_hoje: [{ provedor: 'claude-cli', chamadas: 1, usd: 1 }], avisos: [{ titulo: 'OAuth', ate: '2026-11-11', nivel: 'aviso', vencido: false, dias: 2 }] },
  sites: { desligado: false, checando: false, sites: [{ url: 'https://inema.vip', ok: false, status: 502, ms: null, erro: 'HTTP 502' }, { url: 'https://inema.club', ok: true, status: 200, ms: 100 }], checado_em: T },
  vagas: { classes: [{ classe: 'gpu', vagas: 2, teto: 2, ocupadas: 1, dono: 'r7ex', esperando: 1 }], pode_mudar: true, motivo_so_leitura: null, dica: 'vagas <classe> <n>', internas: { openpcbotv3: { chat: 2 }, inemaccbot: null } },
  terminais: { vivos: [{ session_id: 'abc', projeto: 'wifi', cwd: '/x', tipo: 'interativo', inicio: T - 600, tty: 'pts/1' }], interrompidos: [{ session_id: 'def', projeto: 'r7ex', cwd: '/y' }], miniatura: null },
  vps: { medindo: false, vps: [{ id: 'vps1', nome: 'a<b>', ip: '1.1.1.1', local: 'x', plano: 'p', papel: ['web <i>'], medida: { ok: true, erro: null, disco_pct: 91, disco: '9G/38G', ram_mb: 1400, ram_total_mb: 3800, carga: 0.3, cpus: 2, uptime: '3 weeks', containers: 4, medido_em: T } },
    { id: 'vps2', nome: 'b', ip: '2.2.2.2', local: '', plano: '', papel: [], medida: { ok: false, erro: 'Permission denied', disco_pct: null, disco: null, ram_mb: null, ram_total_mb: null, carga: null, cpus: null, uptime: null, containers: null, medido_em: T } },
    { id: 'vps3', nome: 'c', ip: '3.3.3.3', local: '', plano: '', papel: [], medida: null }] },
  apis: { hoje: [{ provedor: 'openrouter<x>', chamadas: 2, usd: 0.1 }], semana: [], apis: [{ nome: 'GitHub', para: 'repos', situacao: 'liberada', nota: null }], avisos: [{ titulo: 'OAuth', ate: '2026-11-11', nivel: 'aviso', vencido: false, dias: 2 }] },
  esperando: { itens: [{ tipo: 'falha', nivel: 'erro', grupo: 'bots', texto: 'v3 #5 falhou' }, { tipo: 'pendencia', nivel: 'info', grupo: 'esperando', texto: 'P' }] },
};

describe('desenhos do cliente', () => {
  for (const modo of ['lista', 'icones', 'imagens']) {
    it(`todos os grupos desenham no modo ${modo}, escapando HTML`, () => {
      cliente.E.modo = modo;
      for (const [nome, d] of Object.entries(DADOS)) {
        const g = { ok: true, gerado_em: T, dados: d };
        const t = cliente.G[nome].tile(d, g);
        const det = cliente.G[nome].detalhe(d, g);
        expect(t.frase.length, nome).toBeGreaterThan(0);
        expect(det.length, nome).toBeGreaterThan(0);
        expect(t.corpo + det).not.toContain('<b>"x"');
        expect(t.corpo + det).not.toContain('cli<b>');
      }
      expect(cliente.G.producao.tile(DADOS.producao, {}).frase).toContain('parada');
      expect(cliente.G.bots.detalhe(DADOS.bots, {})).toContain('data-falha="v3:5"');
    });
  }
});

describe('rota /api/painel/falha', () => {
  it('devolve o resultado completo do job do v3', async () => {
    const db = new Database(join(mkdtempSync(join(tmpdir(), 'painel-falha-')), 'v3.db'));
    db.exec("CREATE TABLE jobs (id INTEGER PRIMARY KEY, fila TEXT, tarefa TEXT, status TEXT, tentativas INT, max_tentativas INT, erro TEXT, resultado TEXT, criado_em INT, iniciado_em INT, terminado_em INT); INSERT INTO jobs VALUES (5,'agente','cli','failed',1,1,'erro longo','saida completa',1,1,1)");
    const d: DepsPainel = { db, versao: 't', caminhos: caminhosPadrao(tmpdir(), tmpdir()), exec: async () => ({ ok: false, stdout: '', stderr: '', codigo: null }), agora: () => T, cache: new Cache(), concorrenciaV3: {}, fetch: globalThis.fetch, sitesLigado: false };
    const srv = servidorPainel(d);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const p = (srv.address() as AddressInfo).port;
    const ok = await (await fetch(`http://127.0.0.1:${p}/api/painel/falha?bot=v3&id=5`)).json() as { resultado: string };
    const nao = await fetch(`http://127.0.0.1:${p}/api/painel/falha?bot=v3&id=99`);
    const ruim = await fetch(`http://127.0.0.1:${p}/api/painel/falha?id=abc`);
    await new Promise((r) => srv.close(r)); db.close();
    expect(ok.resultado).toBe('saida completa');
    expect(nao.status).toBe(404);
    expect(ruim.status).toBe(400);
  });
});
