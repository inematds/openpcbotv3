// Job #89966 (05/11/2026): hook barrou a sessão retomada e o texto do hook
// virou a resposta do job. Estes testes travam a correção.
import { describe, expect, it } from 'vitest';

import { FakeRunner, type ContextoExecucao } from '../fila/runner.js';
import { bloqueadoPorHook, comRepeticaoSemBloqueio } from './agente-cli.js';

const BLOQUEIO = 'UserPromptSubmit operation blocked by hook:\nSessão parada há 1h02: o cache venceu…';
const json = (result: string, session = 's-nova'): string => JSON.stringify({ result, session_id: session });

function ctx(sessao?: string): ContextoExecucao {
  return {
    prompt: 'oi', cwd: '/tmp', perfil: { motor: 'claude', modelo: 'm', esforco: 'e' },
    vars: { ...(sessao ? { OPENPCBOT_SESSION: sessao } : {}), OPENPCBOT_CHAT: '1' },
    vigia: { arquivo: '/tmp/x.jsonl', prazoMs: 1000 },
  } as ContextoExecucao;
}

describe('bloqueadoPorHook', () => {
  it('reconhece o texto do hook, cru ou no result', () => {
    expect(bloqueadoPorHook(BLOQUEIO)).toBe(true);
    expect(bloqueadoPorHook('Stop operation blocked by hook: x')).toBe(true);
  });
  it('não confunde resposta normal', () => {
    expect(bloqueadoPorHook('Terminei: vídeo. O hook bloqueou ontem, já resolvi.')).toBe(false);
    expect(bloqueadoPorHook('')).toBe(false);
  });
});

describe('comRepeticaoSemBloqueio', () => {
  it('sessão retomada barrada: repete uma vez sem --resume e sem vigia', async () => {
    const base = new FakeRunner({ respostas: [json(BLOQUEIO, 's-velha'), json('feito')] });
    const r = comRepeticaoSemBloqueio(base);
    const saida = await r.iniciar(ctx('s-velha')).aguardar();
    expect(JSON.parse(saida).result).toBe('feito');
    expect(base.chamadas).toHaveLength(2);
    expect(base.chamadas[1].vars.OPENPCBOT_SESSION).toBeUndefined();
    expect(base.chamadas[1].vars.OPENPCBOT_CHAT).toBe('1');
    expect(base.chamadas[1].vigia).toBeUndefined();
  });

  it('texto cru (não JSON) também dispara a repetição', async () => {
    const base = new FakeRunner({ respostas: [BLOQUEIO, json('feito')] });
    await comRepeticaoSemBloqueio(base).iniciar(ctx('s-velha')).aguardar();
    expect(base.chamadas).toHaveLength(2);
  });

  it('sessão nova barrada: não repete (o job falha no interpretarSaida)', async () => {
    const base = new FakeRunner({ respostas: [json(BLOQUEIO)] });
    const saida = await comRepeticaoSemBloqueio(base).iniciar(ctx()).aguardar();
    expect(bloqueadoPorHook(JSON.parse(saida).result)).toBe(true);
    expect(base.chamadas).toHaveLength(1);
  });

  it('resposta normal passa direto', async () => {
    const base = new FakeRunner({ respostas: [json('ok')] });
    await comRepeticaoSemBloqueio(base).iniciar(ctx('s')).aguardar();
    expect(base.chamadas).toHaveLength(1);
  });
});
