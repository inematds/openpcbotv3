// Sites do Nei: um GET leve por site, no máximo a cada 5 min, timeout 8 s, sem
// token nem cookie. Sem timer de fundo: a checagem só acontece enquanto alguém
// olha o painel (o pedido devolve o último resultado e renova em segundo plano).
import type { DepsPainel } from '../tipos.js';
import { lerJson } from '../util.js';

export const INTERVALO_SITES_MS = 5 * 60_000;
export const SITES_PADRAO = ['https://inema.club', 'https://inema.pro', 'https://pay.inema.pro', 'https://inema.vip', 'https://eventos.inema.pro', 'https://news.inema.pro', 'https://aventura.inema.club', 'https://atende-lead.inema.club'];

export interface EstadoSite { url: string; ok: boolean; status: number | null; ms: number | null; erro: string | null; em: number }

export function lerListaSites(j: unknown): string[] {
  const lista = Array.isArray(j) ? j : (j && typeof j === 'object' && Array.isArray((j as { sites?: unknown[] }).sites) ? (j as { sites: unknown[] }).sites : null);
  if (!lista) return SITES_PADRAO;
  return lista.map((s) => (typeof s === 'string' ? s : (s as { url?: string })?.url)).filter((s): s is string => typeof s === 'string' && /^https?:\/\//.test(s));
}

export async function checarSite(f: typeof fetch, url: string, agora: number): Promise<EstadoSite> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await f(url, { method: 'GET', redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': 'painel-inema/1 (checagem de disponibilidade)' } });
    try { await r.body?.cancel(); } catch { /* corpo já fechado */ }
    return { url, ok: r.status < 400, status: r.status, ms: Date.now() - t0, erro: r.status >= 400 ? `HTTP ${r.status}` : null, em: agora };
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? 'sem resposta em 8 s' : ((e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message);
    return { url, ok: false, status: null, ms: null, erro: String(msg), em: agora };
  } finally { clearTimeout(timer); }
}

let emVoo: Promise<void> | null = null;

export interface DadosSites { desligado: boolean; checando: boolean; sites: EstadoSite[]; checado_em: number | null }

export async function coletarSites(d: DepsPainel, esperar = false): Promise<{ dados: DadosSites; ausentes: string[] }> {
  if (!d.sitesLigado) return { dados: { desligado: true, checando: false, sites: [], checado_em: null }, ausentes: [] };
  const lista = lerListaSites(lerJson(d.caminhos.sites));
  const ultimo = d.cache.ultimo<EstadoSite[]>('sites');
  const vencido = !ultimo || Date.now() - ultimo.em >= INTERVALO_SITES_MS;
  if (vencido && !emVoo) {
    emVoo = d.cache.obter('sites', 0, async () => Promise.all(lista.map((u) => checarSite(d.fetch, u, d.agora()))))
      .then(() => undefined, () => undefined).finally(() => { emVoo = null; });
  }
  // Primeira leitura não espera os sites (até 8 s): o cartão mostra "checando" e o próximo ciclo já traz o resultado.
  if (esperar && emVoo) await emVoo;
  const atual = d.cache.ultimo<EstadoSite[]>('sites');
  return { dados: { desligado: false, checando: !atual, sites: atual?.v ?? [], checado_em: atual ? Math.floor(atual.em / 1000) : null }, ausentes: [] as string[] };
}
