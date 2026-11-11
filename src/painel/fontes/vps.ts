// Quadro VPS (Nei, 10/11/2026: "quero card das 6 vps"). Inventário = vps.json da telemetria (nome, IP, papel);
// medida ao vivo por SSH só de leitura (disco, memória, carga, uptime, containers), de 10 em 10 min, em segundo plano.
// Tenta as três chaves conhecidas (padrão, _inema, _vps), porque cada VPS aceita uma (wifi/VPS.md).
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
].join('; ');

export interface Vps { id: string; nome: string; ip: string; local: string; plano: string; papel: string[] }
export interface MedidaVps {
  ok: boolean; erro: string | null; disco_pct: number | null; disco: string | null; ram_mb: number | null; ram_total_mb: number | null;
  carga: number | null; cpus: number | null; uptime: string | null; containers: number | null; medido_em: number;
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
    uptime: (l[5] || '').replace(/^up\s+/, '') || null, containers: num(l[6]), medido_em: agora };
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

let emVoo: Promise<void> | null = null;

export async function coletarVps(d: DepsPainel, esperar = false) {
  const lista = lerInventario(lerJson(d.caminhos.vpsInventario));
  const ausentes = lista.length ? [] : ['inventário das VPS (vps.json da telemetria)'];
  const chaves = ['id_ed25519', 'id_ed25519_inema', 'id_ed25519_vps'].map((k) => join(d.caminhos.sshDir, k)).filter((k) => existsSync(k));
  const ultimo = d.cache.ultimo<Record<string, MedidaVps>>('vps');
  if (lista.length && (!ultimo || Date.now() - ultimo.em >= INTERVALO_VPS_MS) && !emVoo) {
    emVoo = d.cache.obter('vps', 0, async () => Object.fromEntries(await Promise.all(lista.map(async (v) => [v.ip, await sondar(d, v.ip, chaves)] as const))))
      .then(() => undefined, () => undefined).finally(() => { emVoo = null; });
  }
  if (esperar && emVoo) await emVoo;
  const med = d.cache.ultimo<Record<string, MedidaVps>>('vps')?.v ?? {};
  const vps = lista.map((v) => ({ ...v, medida: med[v.ip] ?? null }));
  return { dados: { vps, medindo: !d.cache.ultimo('vps') }, ausentes };
}
