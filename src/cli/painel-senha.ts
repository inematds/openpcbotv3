// Define a senha do painel (porta 3143). Grava SÓ o hash scrypt em
// ~/.config/inema/painel-senha.json (600). Nunca imprime a senha.
//   npm run painel-senha                 pede a senha duas vezes, sem eco
//   npm run painel-senha -- --gerar      cria uma senha forte e a escreve UMA vez em
//                                        ~/.config/inema/painel-senha-inicial.txt (600) para ler e apagar
// PAINEL_SENHA_ARQ troca o arquivo do hash (testes).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { arquivoSenha, gerarHash, gravar600, gravarHash, senhaAleatoria, SENHA_MIN } from '../painel/auth/senha.js';

function perguntar(rotulo: string): Promise<string> {
  return new Promise((ok, erro) => {
    const ent = process.stdin;
    process.stdout.write(rotulo);
    if (!ent.isTTY) {
      // Sem terminal: lê a primeira linha do stdin (ex.: printf '%s\n' "$SENHA" | npm run painel-senha).
      let s = '';
      ent.setEncoding('utf8');
      ent.on('data', (c) => { s += c; });
      ent.on('end', () => { process.stdout.write('\n'); ok(s.split('\n')[0].replace(/\r$/, '')); });
      ent.on('error', erro);
      return;
    }
    let s = '';
    ent.setRawMode(true); ent.resume(); ent.setEncoding('utf8');
    const ler = (c: string) => {
      for (const ch of c) {
        if (ch === '\r' || ch === '\n') { ent.setRawMode(false); ent.pause(); ent.off('data', ler); process.stdout.write('\n'); ok(s); return; }
        if (ch === '\u0003') { ent.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') s = s.slice(0, -1); else s += ch;
      }
    };
    ent.on('data', ler);
  });
}

async function main(): Promise<void> {
  const arq = arquivoSenha();
  if (process.argv.includes('--gerar')) {
    const senha = senhaAleatoria();
    gravarHash(await gerarHash(senha), arq);
    const txt = process.env.PAINEL_SENHA_INICIAL_ARQ || resolve(dirname(arq) || resolve(homedir(), '.config/inema'), 'painel-senha-inicial.txt');
    gravar600(txt, `${senha}\n`);
    console.log(`Senha nova gerada. Hash gravado em ${arq} (600).`);
    console.log(`A senha está em ${txt} (600): leia, guarde e apague o arquivo (rm ${txt}).`);
    console.log('Sessões abertas com a senha antiga deixam de valer.');
    return;
  }
  const s1 = await perguntar('Senha do painel: ');
  if (s1.length < SENHA_MIN) { console.error(`Senha curta: use pelo menos ${SENHA_MIN} caracteres.`); process.exit(1); }
  if (process.stdin.isTTY) {
    const s2 = await perguntar('Repita a senha: ');
    if (s1 !== s2) { console.error('As duas senhas não batem. Nada foi gravado.'); process.exit(1); }
  }
  const existia = existsSync(arq);
  gravarHash(await gerarHash(s1), arq);
  console.log(`Senha ${existia ? 'trocada' : 'definida'}. Hash gravado em ${arq} (600). Sessões antigas deixam de valer.`);
}

main().catch((e) => { console.error((e as Error).message); process.exit(1); });
