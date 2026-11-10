// Filas de publicação e de espera, item por item, num formato só (só leitura).
// Cada sistema guarda a fila do seu jeito (estado/status, JSON/txt/marcador); aqui tudo vira
// { fila, id, nome, estado ∈ pendente|publicando|feito|erro|retirado, canal, quando, tentativas, erro }.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { DepsPainel } from '../tipos.js';
import { corta, lerJson, paraEpoch } from '../util.js';

export type EstadoItem = 'pendente' | 'publicando' | 'feito' | 'erro' | 'retirado';
export interface ItemFila { id: string; nome: string; estado: EstadoItem; original: string; canal: string | null; quando: number | null; tentativas: number | null; erro: string | null; arquivo: string | null }
export interface Fila { chave: string; nome: string; onde: string; quem: string; total: number; por_estado: Record<EstadoItem, number>; itens: ItemFila[]; problema: string | null }

const MAPA: Record<string, EstadoItem> = {
  pendente: 'pendente', na_fila: 'pendente', agendado: 'pendente', esperando: 'pendente', queued: 'pendente',
  rodando: 'publicando', running: 'publicando', publicando: 'publicando',
  feito: 'feito', done: 'feito', publicado: 'feito',
  erro: 'erro', failed: 'erro', falhou: 'erro', parado: 'erro',
  retirado: 'retirado', removido: 'retirado', canceled: 'retirado', cancelado: 'retirado',
};
export const normalizar = (s: unknown): EstadoItem => MAPA[String(s ?? '').toLowerCase()] ?? 'pendente';

const ORDEM: Record<EstadoItem, number> = { publicando: 0, erro: 1, pendente: 2, retirado: 3, feito: 4 };
/** Itens que importam: tudo que não está feito/retirado + os 5 feitos mais recentes. */
const MAX_FEITOS = 5;

function montar(chave: string, nome: string, onde: string, quem: string, itens: ItemFila[], problema: string | null = null): Fila {
  const por = { pendente: 0, publicando: 0, feito: 0, erro: 0, retirado: 0 } as Record<EstadoItem, number>;
  for (const i of itens) por[i.estado]++;
  const abertos = itens.filter((i) => i.estado !== 'feito' && i.estado !== 'retirado');
  const feitos = itens.filter((i) => i.estado === 'feito').sort((a, b) => (b.quando ?? 0) - (a.quando ?? 0)).slice(0, MAX_FEITOS);
  // pendentes mantêm a ordem da fila (é a ordem de saída); o resto por estado.
  const vis = [...abertos.sort((a, b) => ORDEM[a.estado] - ORDEM[b.estado]), ...feitos];
  return { chave, nome, onde, quem, total: itens.length, por_estado: por, itens: vis, problema };
}

const txt = (v: unknown, n = 120) => (v === undefined || v === null || v === '' ? null : corta(String(v), n));

/** Fila JSON (lista ou {itens}) com campo estado ou status. */
export function itensJson(bruto: unknown): ItemFila[] | null {
  const lista = Array.isArray(bruto) ? bruto : (bruto && typeof bruto === 'object' && Array.isArray((bruto as { itens?: unknown[] }).itens) ? (bruto as { itens: unknown[] }).itens : null);
  if (!lista) return null;
  return (lista as Record<string, unknown>[]).filter((x) => x && typeof x === 'object').map((x, i) => {
    const est = x.estado ?? x.status;
    const e = normalizar(est);
    return {
      id: String(x.id ?? x.video_id ?? i), nome: txt(x.titulo_yt ?? x.nome ?? x.titulo ?? x.id ?? x.video_id, 100) ?? '?',
      estado: e, original: String(est ?? ''), canal: txt(x.canal ?? (Array.isArray(x.redes) ? x.redes.join('+') : x.redes), 30),
      quando: paraEpoch(x.quando ?? x.agendado ?? x.publicado_yt ?? x.erro_em),
      tentativas: typeof x.tentativas === 'number' ? x.tentativas : null,
      erro: e === 'erro' ? txt(String(x.erro ?? x.motivo ?? '').trim().split('\n').slice(-2).join(' '), 220) : null,
      arquivo: typeof x.arquivo === 'string' ? basename(x.arquivo) : null,
    };
  });
}

/** fila_publicar.txt das aventuras: uma pasta por linha, a linha some quando publica (tudo é pendente). */
export function itensTxt(texto: string): ItemFila[] {
  return texto.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => ({
    id: basename(l), nome: basename(l), estado: 'pendente' as const, original: 'na lista', canal: 'aventuras', quando: null, tentativas: null, erro: null, arquivo: null,
  }));
}

/** Marcadores PUBLICAR_PENDENTE.<video> (pendente) / .feito nas edições dos virais. */
export function itensMarcadores(raizProjetos: string, agora: number, dias = 14): ItemFila[] {
  const out: ItemFila[] = [];
  let projs: string[] = [];
  try { projs = readdirSync(raizProjetos).filter((p) => /viral$/.test(p)); } catch { return out; }
  for (const p of projs) {
    const ed = join(raizProjetos, p, 'edicoes');
    let eds: string[] = [];
    try { eds = readdirSync(ed); } catch { continue; }
    for (const e of eds) {
      let arqs: string[] = [];
      try { arqs = readdirSync(join(ed, e)).filter((a) => a.startsWith('PUBLICAR_PENDENTE.')); } catch { continue; }
      for (const a of arqs) {
        let t: number | null = null;
        try { t = Math.floor(statSync(join(ed, e, a)).mtimeMs / 1000); } catch { /* sem data */ }
        const feito = a.endsWith('.feito');
        if (feito && t !== null && agora - t > dias * 86400) continue;
        const video = a.replace(/^PUBLICAR_PENDENTE\./, '').replace(/\.feito$/, '');
        out.push({ id: `${p}/${e}/${video}`, nome: `${p} · ${e} · ${video}`, estado: feito ? 'feito' : 'pendente', original: feito ? '.feito' : 'marcador', canal: null, quando: t, tentativas: null, erro: null, arquivo: null });
      }
    }
  }
  return out;
}

/** estado.json do continua (dict por id). Arquivo vazio = problema (foi o que parou o vigia em 10/11). */
export function itensContinua(cam: string): { itens: ItemFila[]; problema: string | null } {
  let bruto = '';
  try { bruto = readFileSync(cam, 'utf8'); } catch { return { itens: [], problema: 'estado.json não encontrado' }; }
  if (!bruto.trim()) return { itens: [], problema: 'estado.json VAZIO — o vigia não consegue ler a lista' };
  let d: Record<string, Record<string, unknown>>;
  try { d = JSON.parse(bruto); } catch { return { itens: [], problema: 'estado.json corrompido' }; }
  return {
    problema: null,
    itens: Object.entries(d).map(([id, it]) => {
      const e = normalizar(it.estado);
      return { id, nome: id, estado: e, original: String(it.estado ?? ''), canal: it.msg ? `v3 msg ${it.msg}` : null, quando: paraEpoch(it.fim ?? it.inicio ?? it.desde), tentativas: null, erro: e === 'erro' ? txt(it.resultado, 220) : null, arquivo: null };
    }),
  };
}

export function coletarFilas(d: DepsPainel): Fila[] {
  const c = d.caminhos;
  const agora = d.agora();
  const filas: Fila[] = [];
  const json = (chave: string, nome: string, cam: string, quem: string) => {
    const it = itensJson(lerJson(cam));
    filas.push(montar(chave, nome, cam, quem, it ?? [], it ? null : 'arquivo da fila não encontrado ou ilegível'));
  };
  json('r7ex', 'r7ex / reels (vários canais)', c.filaR7ex, 'timer fila-lives7: 9, 11, 13, 15, 17, 19 e 21 h');
  json('espanhol', 'Inema Espanhol', c.filaEspanhol, 'timer fila-espanhol: de 2 em 2 h, 6–20 h');
  json('cidades', 'Cidades (timelapse)', c.filaCidades, 'timer fila-cidades: 9, 15 e 21 h');
  json('lives11', 'lives11 → Metricool', c.filaLives11, 'timer metricool-lives11: seg–sex 11:45 e 16:45');
  let t: string | null = null;
  try { t = readFileSync(c.filaAventuras, 'utf8'); } catch { /* ausente */ }
  filas.push(montar('aventuras', 'Aventuras (memórias)', c.filaAventuras, 'aventuras-fila (sem timer)', t === null ? [] : itensTxt(t), t === null ? 'arquivo não encontrado' : null));
  filas.push(montar('marcadores', 'Virais com publicação marcada', join(c.raizProjetos, '*viral/edicoes/*/PUBLICAR_PENDENTE.*'), 'futviral-publicar 12 h, contaviral-publicar 13 h', itensMarcadores(c.raizProjetos, agora)));
  const ct = itensContinua(c.continua);
  filas.push(montar('continua', 'Esperas do continua', c.continua, 'timer continua: a cada 5 min', ct.itens, ct.problema));
  return filas;
}
