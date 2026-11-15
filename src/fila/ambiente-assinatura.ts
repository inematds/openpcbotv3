import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Remove só seletores de autenticação de modelos; ferramentas seguem com suas credenciais. */
export function ambienteAssinatura(motor: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (motor !== 'claude' && motor !== 'codex') return env;
  const limpo = { ...env };
  for (const k of Object.keys(limpo)) {
    if (/^(ANTHROPIC_|OPENAI_|OPENROUTER_|AZURE_OPENAI_|CLAUDE_CODE_OAUTH_TOKEN$|CLAUDE_CODE_USE_|CODEX_API_KEY$)/.test(k)) delete limpo[k];
  }
  if (motor === 'codex') {
    // Mesma conta dos robôs, em vez de herdar a conta do terminal que iniciou o bot.
    const arquivo = resolve(homedir(), '.config/inema/codex-conta.env');
    if (existsSync(arquivo)) {
      const home = readFileSync(arquivo, 'utf8').match(/^CODEX_HOME=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
      if (home) limpo.CODEX_HOME = home;
    }
  }
  return limpo;
}
