// Quadro VPS (Nei, 10/11/2026: "quero card das 6 vps"). Inventário = vps.json da telemetria (nome, IP, papel);
// medida ao vivo por SSH só de leitura (disco, memória, carga, uptime, containers), de 10 em 10 min, em segundo plano.
// Tenta as três chaves conhecidas (padrão, _inema, _vps), porque cada VPS aceita uma (wifi/VPS.md).
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { DepsPainel } from '../tipos.js';
import { lerJson } from '../util.js';

export const INTERVALO_VPS_MS = 10 * 60_000;
const CMD = [
  "df -P / | awk 'NR==2{print $5}'",
  "df -h / | awk 'NR==2{print $3\"/\"$2}'",
  "free -m | awk '/Mem:/{print $3\" \"$2}'",
  'cut -d" " -f1 /proc/loadavg',
  'nproc',
  'uptime -p',
  '(docker ps -q 2>/dev/null | wc -l)',
  // CPU real (Nei, 20/11: "uso de cpu em um gráfico"): duas leituras de /proc/stat com 1 s entre elas.
  'head -1 /proc/stat', 'sleep 1', 'head -1 /proc/stat',
].join('; ');
export const JANELA_HIST_S = 24 * 3600;

export interface Vps { id: string; nome: string; ip: string; local: string; plano: string; papel: string[] }
export interface MedidaVps {
  ok: boolean; erro: string | null; disco_pct: number | null; disco: string | null; ram_mb: number | null; ram_total_mb: number | null;
  carga: number | null; cpus: number | null; uptime: string | null; containers: number | null; medido_em: number; cpu_pct?: number | null;
}

/** % de CPU ocupada entre duas linhas "cpu  user nice system idle iowait irq softirq steal" do /proc/stat. */
export function cpuEntre(a: string | undefined, b: string | undefined): number | null {
  const campos = (l: string | undefined) => (l && /^cpu\s/.test(l) ? l.trim().split(/\s+/).slice(1, 9).map(Number) : null);
  const x = campos(a), y = campos(b);
  if (!x || !y || x.length < 4 || y.length < 4 || [...x, ...y].some((n) => !Number.isFinite(n))) return null;
  const tot = (v: number[]) => v.reduce((s, n) => s + n, 0), ocioso = (v: number[]) => v[3] + (v[4] ?? 0);
  const dt = tot(y) - tot(x), di = ocioso(y) - ocioso(x);
  return dt > 0 ? Math.max(0, Math.min(100, Math.round(100 * (dt - di) / dt))) : null;
}

/** Junta a medida nova ao histórico [epoch, %] de cada IP, mantendo só as últimas 24 h. */
export function somarHistorico(hist: Record<string, [number, number][]>, med: Record<string, MedidaVps>, agora: number): Record<string, [number, number][]> {
  const out: Record<string, [number, number][]> = {};
  const ips = new Set([...Object.keys(hist), ...Object.keys(med)]);
  for (const ip of ips) {
    const l = (Array.isArray(hist[ip]) ? hist[ip] : []).filter((p) => Array.isArray(p) && p[0] > agora - JANELA_HIST_S);
    const m = med[ip];
    if (m?.ok && typeof m.cpu_pct === 'number' && !l.some((p) => p[0] === m.medido_em)) l.push([m.medido_em, m.cpu_pct]);
    if (l.length) out[ip] = l.slice(-200);
  }
  return out;
}

export function lerInventario(j: unknown): Vps[] {
  const l = (j as { vps?: unknown[] } | null)?.vps;
  if (!Array.isArray(l)) return [];
  return l.flatMap((x) => {
    const v = x as Record<string, unknown>;
    if (typeof v.ip !== 'string') return [];
    return [{ id: String(v.id ?? v.ip), nome: String(v.nome ?? v.hostname ?? v.ip), ip: v.ip, local: String(v.local ?? ''), plano: String(v.plano ?? ''),
      papel: Array.isArray(v.roda) ? v.roda.map((r) => String(r).slice(0, 120)).slice(0, 6) : [] }];
  });
}

export function lerMedida(stdout: string, agora: number): MedidaVps {
  const l = stdout.trim().split('\n').map((s) => s.trim());
  const num = (s: string | undefined) => { const n = Number.parseFloat(String(s ?? '').replace('%', '')); return Number.isFinite(n) ? n : null; };
  const [usado, total] = (l[2] ?? '').split(' ');
  return { ok: true, erro: null, disco_pct: num(l[0]), disco: l[1] || null, ram_mb: num(usado), ram_total_mb: num(total), carga: num(l[3]), cpus: num(l[4]),
    uptime: (l[5] || '').replace(/^up\s+/, '') || null, containers: num(l[6]), medido_em: agora, cpu_pct: cpuEntre(l[7], l[8]) };
}

async function sondar(d: DepsPainel, ip: string, chaves: string[]): Promise<MedidaVps> {
  const r = await d.exec('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
    ...chaves.flatMap((k) => ['-i', k]), `root@${ip}`, CMD], 15_000);
  if (!r.ok) {
    const erro = (r.stderr || r.erro || `saída ${r.codigo}`).trim().split('\n').pop() ?? 'falhou';
    return { ok: false, erro: erro.replace(/root@[\d.]+:\s*/, '').slice(0, 140), disco_pct: null, disco: null, ram_mb: null, ram_total_mb: null, carga: null, cpus: null, uptime: null, containers: null, medido_em: d.agora() };
  }
  return lerMedida(r.stdout, d.agora());
}

function gravarHistorico(arq: string, h: Record<string, [number, number][]>) {
  try { mkdirSync(dirname(arq), { recursive: true }); writeFileSync(arq + '.tmp', JSON.stringify(h)); renameSync(arq + '.tmp', arq); } catch { /* sem disco: o gráfico só fica sem histórico */ }
}

let emVoo: Promise<void> | null = null;

export async function coletarVps(d: DepsPainel, esperar = false) {
  const lista = lerInventario(lerJson(d.caminhos.vpsInventario));
  const ausentes = lista.length ? [] : ['inventário das VPS (vps.json da telemetria)'];
  const chaves = ['id_ed25519', 'id_ed25519_inema', 'id_ed25519_vps'].map((k) => join(d.caminhos.sshDir, k)).filter((k) => existsSync(k));
  const ultimo = d.cache.ultimo<Record<string, MedidaVps>>('vps');
  if (lista.length && (!ultimo || Date.now() - ultimo.em >= INTERVALO_VPS_MS) && !emVoo) {
    emVoo = d.cache.obter('vps', 0, async () => {
      const med = Object.fromEntries(await Promise.all(lista.map(async (v) => [v.ip, await sondar(d, v.ip, chaves)] as const)));
      gravarHistorico(d.caminhos.vpsCpuHist, somarHistorico(lerJson<Record<string, [number, number][]>>(d.caminhos.vpsCpuHist) ?? {}, med, d.agora()));
      return med;
    })
      .then(() => undefined, () => undefined).finally(() => { emVoo = null; });
  }
  if (esperar && emVoo) await emVoo;
  const med = d.cache.ultimo<Record<string, MedidaVps>>('vps')?.v ?? {};
  const hist = lerJson<Record<string, [number, number][]>>(d.caminhos.vpsCpuHist) ?? {};
  const vps = lista.map((v) => ({ ...v, medida: med[v.ip] ?? null, cpu_hist: Array.isArray(hist[v.ip]) ? hist[v.ip] : [] }));
  return { dados: { vps, medindo: !d.cache.ultimo('vps') }, ausentes };
}
