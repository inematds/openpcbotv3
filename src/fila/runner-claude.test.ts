import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ClaudeRunner, argumentosClaude, comandoComTeto } from './runner-claude.js';
import { RUNNERS } from './runner.js';

/** O caminho do sleep varia por distro; o repo já checa os dois. */
const binarioSleep = (): string =>
  existsSync('/bin/sleep') ? '/bin/sleep' : '/usr/bin/sleep';

/** Arquivos que o payload NÃO deveria criar — apagados de qualquer jeito. */
const criados: string[] = [];
afterEach(() => {
  for (const f of criados.splice(0)) rmSync(f, { force: true });
});

const ctx = (modelo: string, esforco: string) => ({
  prompt: 'faça X', cwd: '/tmp',
  perfil: { motor: 'claude', modelo, esforco }, vars: {},
});

describe('argumentosClaude', () => {
  it('traduz o perfil em flags da CLI, com o prompt por último', () => {
    expect(argumentosClaude(ctx('opus', 'high')))
      .toEqual(['--model', 'opus', '--effort', 'high', '-p', 'faça X']);
  });

  it('nunca usa shell: os argumentos são um array, sem interpolação', () => {
    const args = argumentosClaude({ ...ctx('sonnet', 'low'), prompt: 'rm -rf / ; echo oi' });
    expect(args[args.length - 1]).toBe('rm -rf / ; echo oi');
    expect(args.join(' ')).not.toContain('&&');
  });
});

describe('comandoComTeto (escopo systemd do agente)', () => {
  it('sem teto: o binário direto', () => {
    expect(comandoComTeto('claude', ['-p', 'x'])).toEqual(['claude', ['-p', 'x']]);
  });
  it('com teto: systemd-run --scope com MemoryMax e sem swap, binário depois de --', () => {
    const [cmd, args] = comandoComTeto('claude', ['-p', 'x'], '16G');
    expect(cmd).toBe('systemd-run');
    expect(args).toContain('--scope');
    expect(args).toContain('MemoryMax=16G');
    expect(args).toContain('MemorySwapMax=0');
    expect(args.join(' ')).not.toContain('-p x --'); // o prompt não vira nome do escopo
    expect(args).toContain('--description=openpcbotv3 agente');
    expect(args.slice(args.indexOf('--') + 1)).toEqual(['claude', '-p', 'x']);
  });
  // Só onde há systemd de usuário (o servidor do bot); em CI sem user bus, pula.
  const temUserBus = !!process.env.XDG_RUNTIME_DIR && existsSync(join(process.env.XDG_RUNTIME_DIR, 'bus'));
  it.skipIf(!temUserBus)('estourou o teto → morre só o filho, com erro de memória', async () => {
    const r = new ClaudeRunner({
      binario: process.execPath, memoriaMax: '64M',
      montarArgs: () => ['-e', 'const a=[];for(;;)a.push(Buffer.alloc(8<<20,1))'],
    });
    await expect(r.iniciar(ctx('opus', 'high')).aguardar()).rejects.toThrow(/memória/);
  }, 30_000);
  it.skipIf(!temUserBus)('dentro do teto → saída normal', async () => {
    const r = new ClaudeRunner({ binario: '/bin/echo', memoriaMax: '256M', montarArgs: () => ['RESULT: ok'] });
    await expect(r.iniciar(ctx('opus', 'high')).aguardar()).resolves.toBe('RESULT: ok');
  });
});

describe('registro de motores', () => {
  it('registra "claude" em RUNNERS', () => {
    expect(RUNNERS.claude).toBeInstanceOf(ClaudeRunner);
    expect(RUNNERS.claude.nome).toBe('claude');
  });
});

describe('execução real de subprocesso (usa /bin/echo como binário)', () => {
  it('devolve o stdout', async () => {
    const r = new ClaudeRunner('/bin/echo');
    const saida = await r.iniciar(ctx('sonnet', 'low')).aguardar();
    expect(saida).toContain('--model sonnet');
  });

  // O prazo de escalada pra SIGKILL é 2s. Se `cancelar` não corresse contra a
  // saída do filho, TODO cancelamento pagaria esses 2s — por job, no /cancelar
  // e no timeout do drain. O limite de 1_500ms é folgado de propósito.
  it('cancelar volta assim que o filho morre, sem pagar o prazo do SIGKILL', async () => {
    const r = new ClaudeRunner(binarioSleep());
    const exec = r.iniciar({ ...ctx('sonnet', 'low'), prompt: '30' });
    const p = exec.aguardar();
    const t0 = Date.now();
    await exec.cancelar();
    const decorrido = Date.now() - t0;
    await expect(p).rejects.toThrow(/cancelad/);
    expect(decorrido).toBeLessThan(1_500);
  });

  // Sem teto de parede, um `claude -p` travado segura um slot da fila PARA
  // SEMPRE: o heartbeat renova o lease enquanto o processo existir, o job nunca
  // termina e nada notifica (§8). O binário aqui é o próprio node, com um
  // programa que só espera — é a forma de ter um processo realmente travado sem
  // depender do `claude` existir no ambiente de teste.
  it('mata a execução que passa do timeoutMs e falha com a causa explícita', async () => {
    const r = new ClaudeRunner({
      binario: process.execPath,
      montarArgs: () => ['-e', 'setTimeout(() => {}, 60_000)'],
    });
    const t0 = Date.now();
    await expect(r.iniciar({ ...ctx('sonnet', 'low'), timeoutMs: 300 }).aguardar())
      .rejects.toThrow(/timeout/i);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('sem timeoutMs não há prazo — o processo curto termina normalmente', async () => {
    const r = new ClaudeRunner('/bin/echo');
    await expect(r.iniciar(ctx('sonnet', 'low')).aguardar()).resolves.toContain('--model');
  });

  // `stdout += String(d)` sem teto: um agente em laço de log come a memória do
  // serviço inteiro. O v1 tinha `maxBuffer: 10MB`; aqui isso tinha se perdido.
  it('para de acumular saída no teto configurado', async () => {
    const r = new ClaudeRunner({
      binario: process.execPath,
      montarArgs: () => ['-e', 'process.stdout.write("x".repeat(200000))'],
      limiteSaidaBytes: 1_000,
    });
    const saida = await r.iniciar(ctx('sonnet', 'low')).aguardar();
    expect(saida.length).toBeLessThanOrEqual(1_000);
  });

  // O teste de "sem shell" acima olha só o ARRAY de argumentos — função pura que
  // nunca faz spawn. Aqui o payload atravessa o spawn de verdade: tem que chegar
  // como STRING LITERAL e não pode executar nada.
  it('o payload de shell atravessa o spawn como literal, sem efeito colateral', async () => {
    const alvo = join(tmpdir(), `inemaccbot-pwned-${process.pid}-${Date.now()}`);
    criados.push(alvo);
    const payload = `\`$(touch ${alvo}); rm -rf naoexiste\``;

    const r = new ClaudeRunner('/bin/echo');
    const saida = await r.iniciar({ ...ctx('sonnet', 'low'), prompt: payload }).aguardar();

    expect(saida).toContain(payload);
    expect(existsSync(alvo)).toBe(false);
  });
});
