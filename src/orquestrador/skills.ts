// Registry de skills (portado do v2). Só METADATA entra no prompt (openclaw
// token-use): nome + descrição; o corpo é lido sob demanda por quem executa.
import fs from 'node:fs';
import path from 'node:path';

import { RAIZ } from '../config/env.js';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  dir: string;
  rascunho: boolean;
}

export const SKILLS_DIR = path.join(RAIZ, 'skills');

export function parseSkillFrontMatter(md: string): { name: string; description: string } | null {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const body = m[1];
  const field = (key: string): string => {
    const re = new RegExp(`^${key}:[ \\t]*(.*(?:\\r?\\n[ \\t]+.*)*)`, 'm');
    const hit = body.match(re);
    if (!hit) return '';
    return hit[1].replace(/\s*\r?\n\s+/g, ' ').replace(/^["']|["']$/g, '').trim();
  };
  const name = field('name');
  const description = field('description');
  if (!name) return null;
  return { name, description };
}

function lerDir(dir: string, rascunho: boolean): SkillInfo[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out: SkillInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    const skillDir = path.join(dir, e.name);
    let md: string;
    try { md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'); } catch { continue; }
    const meta = parseSkillFrontMatter(md);
    if (!meta) continue;
    out.push({ id: e.name, name: meta.name, description: meta.description, dir: skillDir, rascunho });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function listarSkills(dir: string = SKILLS_DIR): SkillInfo[] {
  return [...lerDir(dir, false), ...lerDir(path.join(dir, '_rascunhos'), true)];
}

export function truncar(text: string, maxChars: number): string {
  const clean = text.trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars).trimEnd()}...`;
}

/** Bloco compacto para o prompt do agente CLI: uma linha por skill. */
export function blocoSkills(skills: SkillInfo[], rootDir: string = RAIZ): string[] {
  const ativas = skills.filter((s) => !s.rascunho);
  if (!ativas.length) return [];
  return [
    `Skills em ${rootDir}/skills/. Leia <skill>/SKILL.md antes de usar uma:`,
    ...ativas.map((s) => `- ${s.id} — ${truncar(s.description, 160)}`),
    'Skill que cabe no pedido vence resposta de memória. Se o preflight (ping) falhar, diga qual serviço está fora.',
  ];
}

/** Escreve um rascunho de skill (loop de aprendizado Hermes). Nunca promove. */
export function gravarRascunho(id: string, nome: string, descricao: string, corpo: string, dir: string = SKILLS_DIR): string {
  const seguro = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'skill';
  const alvo = path.join(dir, '_rascunhos', seguro);
  fs.mkdirSync(alvo, { recursive: true });
  const md = `---\nname: ${nome}\ndescription: ${descricao.replace(/\n/g, ' ')}\nstatus: rascunho\n---\n\n${corpo.trim()}\n`;
  fs.writeFileSync(path.join(alvo, 'SKILL.md'), md);
  return alvo;
}

let cache: SkillInfo[] | null = null;
export function skillsCacheadas(): SkillInfo[] {
  if (cache === null) cache = listarSkills();
  return cache;
}
