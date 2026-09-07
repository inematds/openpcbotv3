// Leitura de memória do host. Só /proc/meminfo — sem dependência nativa.
import { readFileSync } from 'node:fs';

export interface EstadoRam {
  totalGb: number;
  disponivelGb: number;
  swapUsadoGb: number;
}

export function lerRam(meminfo = lerMeminfo()): EstadoRam {
  const kb = (chave: string): number => {
    const m = meminfo.match(new RegExp(`^${chave}:\\s+(\\d+)`, 'm'));
    return m ? Number(m[1]) : 0;
  };
  const gb = (v: number): number => Math.round((v / 1024 / 1024) * 10) / 10;
  return {
    totalGb: gb(kb('MemTotal')),
    disponivelGb: gb(kb('MemAvailable')),
    swapUsadoGb: gb(kb('SwapTotal') - kb('SwapFree')),
  };
}

function lerMeminfo(): string {
  try { return readFileSync('/proc/meminfo', 'utf8'); } catch { return ''; }
}

/** RSS deste processo em MB (para o /health e o dashboard). */
export function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}
