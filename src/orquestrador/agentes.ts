// Registry de agentes especialistas (`agents/*/agent.yaml`, portado do v2).
// Padrão grokky: N especialistas READ-ONLY em paralelo + 1 lead com escrita.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { RAIZ } from '../config/env.js';

export interface Agente {
  id: string;
  nome: string;
  descricao: string;
  /** Alias da CLI (`opus`, `sonnet`, `haiku`, `fable`) ou id completo. */
  modelo: string;
  esforco: string;
  /** Especialista só lê (pesquisa/análise); só o `lead` escreve. */
  somenteLeitura: boolean;
  cwd: string;
  dir: string;
  prompt: string;
}

export const AGENTS_DIR = path.join(RAIZ, 'agents');

function aliasModelo(m: unknown): string {
  const s = String(m ?? 'sonnet');
  if (/opus/i.test(s)) return 'opus';
  if (/haiku/i.test(s)) return 'haiku';
  if (/fable|mythos/i.test(s)) return 'fable';
  return 'sonnet';
}

export function listarAgentes(dir: string = AGENTS_DIR): Agente[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out: Agente[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    const d = path.join(dir, e.name);
    let doc: Record<string, unknown>;
    try { doc = (yaml.load(fs.readFileSync(path.join(d, 'agent.yaml'), 'utf8')) as Record<string, unknown>) ?? {}; } catch { continue; }
    let prompt = '';
    for (const nome of ['CLAUDE.md', 'AGENT.md', 'prompt.md']) {
      try { prompt = fs.readFileSync(path.join(d, nome), 'utf8'); break; } catch { /* próximo */ }
    }
    out.push({
      id: e.name,
      nome: String(doc.name ?? e.name),
      descricao: String(doc.description ?? ''),
      modelo: aliasModelo(doc.model),
      esforco: String(doc.effort ?? 'medium'),
      somenteLeitura: doc.read_only === true || e.name === 'research',
      cwd: String(doc.cwd ?? path.join(process.env.HOME ?? '', 'projetos')),
      dir: d,
      prompt: prompt.slice(0, 6000),
    });
  }
  // Lead genérico: o próprio openpcbot com escrita, para pedidos sem especialista.
  out.push({
    id: 'lead', nome: 'Lead', descricao: 'Agente geral com escrita (código, arquivos, shell) — assume quando nenhum especialista cabe',
    modelo: 'sonnet', esforco: 'medium', somenteLeitura: false,
    cwd: path.join(process.env.HOME ?? '', 'projetos'), dir, prompt: '',
  });
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function blocoAgentes(agentes: Agente[]): string {
  return agentes.map((a) => `- ${a.id}: ${a.descricao || a.nome}${a.somenteLeitura ? ' (só leitura)' : ''}`).join('\n');
}

let cache: Agente[] | null = null;
export function agentesCacheados(): Agente[] {
  if (cache === null) cache = listarAgentes();
  return cache;
}
