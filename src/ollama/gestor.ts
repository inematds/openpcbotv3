// Gestor do Ollama (plano §4.3) — módulo NOVO. Fala só HTTP com o serviço
// systemd (regra de ouro 3). Responsabilidades:
//   - registry de papéis (roteador / geral / embed / pesado)
//   - política de residência: 1 modelo grande; preflight de RAM antes de
//     carregar qualquer modelo que NÃO esteja residente
//   - durante a coexistência com o v2: NUNCA descarrega modelo que não carregou
//   - health probe periódico (tags + ps + latência a quente)
import { lerRam, type EstadoRam } from './ram.js';
import type { ConfigOllama, PapelOllama } from '../config/yaml.js';

export type Papel = keyof ConfigOllama['papeis'];

export interface ModeloCarregado {
  name: string;
  size: number;
  size_vram?: number;
  expires_at?: string;
}

export interface EstadoOllama {
  online: boolean;
  carregados: ModeloCarregado[];
  latenciaMs: number | null;
  ram: EstadoRam;
  erro?: string;
  probeEm: number;
}

export interface Preflight {
  ok: boolean;
  motivo: string;
  residente: boolean;
  ram: EstadoRam;
}

export interface OpcoesGestor {
  url: string;
  config: ConfigOllama;
  fetchFn?: typeof fetch;
  lerRamFn?: () => EstadoRam;
  log?: (m: string) => void;
}

/** Tamanho aproximado em GB por tag conhecida (para o preflight sem baixar nada). */
const TAMANHO_GB: Record<string, number> = {
  'llama3.2': 2, 'bge-m3': 1.2, 'llama3.1:8b': 5, 'qwen2.5:14b': 9, 'deepseek-r1:14b': 9,
  'qwen3.8:27b': 17, 'qwen3.8-64k': 17, 'qwen3:30b': 18, 'command-r:35b': 18,
  'qwen3.6:35b-a3b': 23, 'qwen-agentic': 37, 'llama3.1:70b': 42, 'llama3.1-70b-16k': 42, 'llama3.1-70b-32k': 42,
};
const GRANDE_GB = 12;

export class GestorOllama {
  private readonly fetchFn: typeof fetch;
  private readonly lerRamFn: () => EstadoRam;
  private readonly log: (m: string) => void;
  /** Modelos que ESTE processo carregou — só estes podem ser descarregados por nós. */
  private readonly meus = new Set<string>();
  private ultimo: EstadoOllama | null = null;

  constructor(private readonly opts: OpcoesGestor) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.lerRamFn = opts.lerRamFn ?? lerRam;
    this.log = opts.log ?? (() => {});
  }

  papel(p: Papel): PapelOllama {
    return this.opts.config.papeis[p];
  }

  modeloDe(p: Papel): string {
    return this.papel(p).modelo;
  }

  get estado(): EstadoOllama | null {
    return this.ultimo;
  }

  async tags(): Promise<string[]> {
    const r = await this.fetchFn(`${this.opts.url}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`tags ${r.status}`);
    const d = (await r.json()) as { models?: { name: string }[] };
    return (d.models ?? []).map((m) => m.name);
  }

  async carregados(): Promise<ModeloCarregado[]> {
    const r = await this.fetchFn(`${this.opts.url}/api/ps`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`ps ${r.status}`);
    const d = (await r.json()) as { models?: ModeloCarregado[] };
    return d.models ?? [];
  }

  /** Nome normalizado: `qwen3.8:27b` e `qwen3.8:27b` batem; `llama3.2` casa `llama3.2:latest`. */
  static mesmoModelo(a: string, b: string): boolean {
    const n = (s: string): string => (s.includes(':') ? s : `${s}:latest`);
    return n(a) === n(b);
  }

  static tamanhoGb(modelo: string): number {
    const chave = Object.keys(TAMANHO_GB).find((k) => GestorOllama.mesmoModelo(k, modelo));
    return chave ? TAMANHO_GB[chave] : GRANDE_GB;
  }

  /**
   * Pode carregar `modelo` agora? Regras (na ordem):
   *  1. já residente → sim, custo zero.
   *  2. modelo pequeno (< GRANDE_GB) → sim se RAM disponível ≥ tamanho + 4 GB.
   *  3. modelo grande e já existe OUTRO grande residente → não (política de 1
   *     residente). Não descarregamos o outro: pode ser do v2.
   *  4. modelo grande → só se RAM disponível ≥ piso_ram_gb.
   */
  async preflight(modelo: string, carregados?: ModeloCarregado[]): Promise<Preflight> {
    const ram = this.lerRamFn();
    const ps = carregados ?? (await this.carregados().catch(() => [] as ModeloCarregado[]));
    if (ps.some((m) => GestorOllama.mesmoModelo(m.name, modelo))) {
      return { ok: true, motivo: 'residente', residente: true, ram };
    }
    const tam = GestorOllama.tamanhoGb(modelo);
    if (tam < GRANDE_GB) {
      const ok = ram.disponivelGb >= tam + 4;
      return { ok, motivo: ok ? `pequeno (${tam} GB)` : `RAM ${ram.disponivelGb} GB < ${tam + 4} GB`, residente: false, ram };
    }
    const outroGrande = ps.find((m) => GestorOllama.tamanhoGb(m.name) >= GRANDE_GB);
    if (outroGrande) {
      return { ok: false, motivo: `já há modelo grande residente (${outroGrande.name}) — política de 1 residente`, residente: false, ram };
    }
    const piso = this.opts.config.piso_ram_gb;
    const ok = ram.disponivelGb >= piso;
    return { ok, motivo: ok ? `RAM ${ram.disponivelGb} GB ≥ piso ${piso} GB` : `RAM ${ram.disponivelGb} GB < piso ${piso} GB`, residente: false, ram };
  }

  /** Marca que ESTE processo carregou o modelo (chamado pelo provedor após sucesso). */
  marcarMeu(modelo: string): void {
    this.meus.add(modelo);
  }

  /**
   * Descarrega um modelo (keep_alive 0). Recusa modelo que não é nosso quando
   * `descarregar_alheios` é falso — é o v2 que pode estar usando.
   */
  async descarregar(modelo: string, forcar = false): Promise<{ ok: boolean; motivo: string }> {
    const nosso = [...this.meus].some((m) => GestorOllama.mesmoModelo(m, modelo));
    if (!nosso && !forcar && !this.opts.config.descarregar_alheios) {
      return { ok: false, motivo: `${modelo} não foi carregado por este processo (pode ser do v2) — recusado` };
    }
    const r = await this.fetchFn(`${this.opts.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo, keep_alive: 0 }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return { ok: false, motivo: `HTTP ${r.status}` };
    this.meus.delete(modelo);
    return { ok: true, motivo: 'descarregado' };
  }

  /** Probe: tags, ps e latência de um "ok" a quente no roteador (pequeno). */
  async probe(): Promise<EstadoOllama> {
    const ram = this.lerRamFn();
    const probeEm = Math.floor(Date.now() / 1000);
    try {
      const carregados = await this.carregados();
      let latenciaMs: number | null = null;
      const roteador = this.modeloDe('roteador');
      const quente = carregados.some((m) => GestorOllama.mesmoModelo(m.name, roteador));
      if (quente) {
        const t0 = Date.now();
        const r = await this.fetchFn(`${this.opts.url}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: roteador, prompt: 'ok', stream: false, options: { num_predict: 1 }, keep_alive: this.papel('roteador').keep_alive ?? '10m' }),
          signal: AbortSignal.timeout(15_000),
        });
        if (r.ok) latenciaMs = Date.now() - t0;
      }
      this.ultimo = { online: true, carregados, latenciaMs, ram, probeEm };
    } catch (e) {
      this.ultimo = { online: false, carregados: [], latenciaMs: null, ram, erro: (e as Error).message, probeEm };
    }
    return this.ultimo;
  }

  /** Alertas derivados do último probe (quem consome é a telemetria). */
  avaliar(estado: EstadoOllama): { chave: string; nivel: 'aviso' | 'erro'; texto: string }[] {
    const out: { chave: string; nivel: 'aviso' | 'erro'; texto: string }[] = [];
    if (!estado.online) out.push({ chave: 'ollama.fora', nivel: 'erro', texto: `Ollama fora do ar: ${estado.erro ?? '?'}` });
    if (estado.latenciaMs !== null && estado.latenciaMs > this.opts.config.latencia_alerta_ms) {
      out.push({ chave: 'ollama.lento', nivel: 'aviso', texto: `Ollama lento a quente: ${estado.latenciaMs} ms` });
    }
    if (estado.ram.disponivelGb < 10) {
      out.push({ chave: 'ram.baixa', nivel: 'erro', texto: `RAM disponível ${estado.ram.disponivelGb} GB (swap usado ${estado.ram.swapUsadoGb} GB)` });
    }
    const grandes = estado.carregados.filter((m) => GestorOllama.tamanhoGb(m.name) >= GRANDE_GB);
    if (grandes.length > 1) {
      out.push({ chave: 'ollama.dois-grandes', nivel: 'aviso', texto: `Dois modelos grandes residentes: ${grandes.map((m) => m.name).join(', ')}` });
    }
    return out;
  }

  resumo(): string {
    const e = this.ultimo;
    if (!e) return 'Ollama: sem probe ainda';
    if (!e.online) return `Ollama: FORA (${e.erro})`;
    const mods = e.carregados.length ? e.carregados.map((m) => `${m.name} (${Math.round(m.size / 1e9)} GB)`).join(', ') : 'nenhum carregado';
    return `Ollama: online · ${mods} · latência ${e.latenciaMs ?? '-'} ms · RAM livre ${e.ram.disponivelGb} GB · swap ${e.ram.swapUsadoGb} GB`;
  }
}
