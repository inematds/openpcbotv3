import { describe, expect, it } from 'vitest';

import { OLLAMA_DEFAULT } from '../config/yaml.js';
import { GestorOllama, type ModeloCarregado } from './gestor.js';

const ram = (disponivelGb: number) => (): { totalGb: number; disponivelGb: number; swapUsadoGb: number } => ({ totalGb: 119, disponivelGb, swapUsadoGb: 8 });
const fetchNunca: typeof fetch = async () => { throw new Error('fetch não deveria ser chamado'); };
const fetchOk = (body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;

function gestor(disp: number, fetchFn: typeof fetch = fetchNunca): GestorOllama {
  return new GestorOllama({ url: 'http://x', config: { ...OLLAMA_DEFAULT, piso_ram_gb: 40 }, fetchFn, lerRamFn: ram(disp) });
}

const q27: ModeloCarregado = { name: 'qwen3.8:27b', size: 17e9 };

describe('preflight de RAM (garantia de não faltar memória)', () => {
  it('modelo já residente passa sempre, mesmo com RAM baixa', async () => {
    const p = await gestor(3).preflight('qwen3.8:27b', [q27]);
    expect(p).toMatchObject({ ok: true, residente: true });
  });

  it('modelo grande NÃO residente exige o piso', async () => {
    expect((await gestor(30).preflight('qwen3.8:27b', [])).ok).toBe(false);
    expect((await gestor(45).preflight('qwen3.8:27b', [])).ok).toBe(true);
  });

  it('política de 1 residente: outro grande carregado (do v2) bloqueia, e nada é descarregado', async () => {
    const p = await gestor(100).preflight('qwen3.6:35b-a3b', [q27]);
    expect(p.ok).toBe(false);
    expect(p.motivo).toMatch(/1 residente/);
  });

  it('modelo pequeno só precisa de tamanho + 4 GB', async () => {
    expect((await gestor(5).preflight('llama3.2', [q27])).ok).toBe(false);
    expect((await gestor(7).preflight('llama3.2', [q27])).ok).toBe(true);
  });

  it('nomes com e sem :latest são o mesmo modelo', () => {
    expect(GestorOllama.mesmoModelo('llama3.2', 'llama3.2:latest')).toBe(true);
    expect(GestorOllama.mesmoModelo('qwen3.8:27b', 'qwen3.8-64k:latest')).toBe(false);
  });
});

describe('descarregar', () => {
  it('recusa modelo que este processo não carregou (pode ser do v2)', async () => {
    const r = await gestor(50).descarregar('qwen3.8:27b');
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/v2/);
  });

  it('descarrega o que é nosso', async () => {
    const g = gestor(50, fetchOk({}));
    g.marcarMeu('llama3.2');
    expect((await g.descarregar('llama3.2:latest')).ok).toBe(true);
  });
});

describe('avaliar alertas', () => {
  it('RAM baixa e dois grandes viram alerta', () => {
    const g = gestor(50);
    const al = g.avaliar({ online: true, carregados: [q27, { name: 'qwen3.6:35b-a3b', size: 23e9 }], latenciaMs: 100, ram: { totalGb: 119, disponivelGb: 6, swapUsadoGb: 12 }, probeEm: 0 });
    expect(al.map((a) => a.chave).sort()).toEqual(['ollama.dois-grandes', 'ram.baixa']);
  });
});
