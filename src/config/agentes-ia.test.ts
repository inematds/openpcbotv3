import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lerAgentesIA } from './agentes-ia.js';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function arquivo(texto: string) {
  const d = mkdtempSync(join(tmpdir(), 'agentes-config-')); dirs.push(d);
  const f = join(d, 'ia.yaml'); writeFileSync(f, texto); return f;
}
describe('configuração de agentes por assinatura', () => {
  it('valida antes da execução e não aceita APIs nem esforço ignorado', () => {
    expect(() => lerAgentesIA(arquivo('motor: api\ncodex: { modelo: gpt-6.1-sol, esforco: medium }'))).toThrow(/inválido/);
    expect(() => lerAgentesIA(arquivo('motor: codex\ncodex: { modelo: gpt-6.1-sol, esforco: max }'))).toThrow(/inválido/);
    expect(() => lerAgentesIA(arquivo('motor: codex'))).toThrow(/inválido/);
    expect(lerAgentesIA(arquivo('# comentário mantido\nmotor: codex\ncodex: { modelo: gpt-6.1-sol, esforco: xhigh }')).codex.esforco).toBe('xhigh');
  });
});
