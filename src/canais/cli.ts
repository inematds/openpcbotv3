// Canal CLI: stdin → bus, bus → stdout. Só quando o processo tem TTY ou
// `--cli`. É o que mantém o v3 "no ar" e testável sem token de Telegram.
import { createInterface } from 'node:readline';

import type { Bus } from '../bus/bus.js';
import { novoTraceId } from '../bus/bus.js';

export function ligarCli(bus: Bus, agora: () => number, chatId = 'cli'): () => void {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'você> ' });
  const off = bus.on('mensagem.enviar', (m) => {
    if (m.canal !== 'cli') return;
    process.stdout.write(`\nbot> ${m.texto}\n`);
    rl.prompt();
  });
  rl.on('line', (linha) => {
    const texto = linha.trim();
    if (!texto) { rl.prompt(); return; }
    bus.emit('mensagem.recebida', { canal: 'cli', chatId, texto, traceId: novoTraceId(), recebidaEm: agora() });
  });
  rl.prompt();
  return () => { off(); rl.close(); };
}
