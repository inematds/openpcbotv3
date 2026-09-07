// Guarda de exfiltração (gap #2 do v2, severidade alta): nenhum segredo sai
// por `sendMessage`. Padrões conhecidos + valores das próprias variáveis de
// ambiente sensíveis. Substitui por `[REDIGIDO]`.
const PADROES: RegExp[] = [
  /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g,                // token de bot Telegram
  /\bsk-(?:ant-|or-)?[A-Za-z0-9_-]{20,}\b/g,      // OpenAI / Anthropic / OpenRouter
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,           // Slack
  /\bgsk_[A-Za-z0-9]{20,}\b/g,                    // Groq
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,                  // Google API
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,              // GitHub
  /\bAKIA[0-9A-Z]{16}\b/g,                        // AWS
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
];

const SUFIXOS_SENSIVEIS = /(TOKEN|KEY|SECRET|PASSWORD|PASS|COOKIE)$/;

export function valoresSensiveisDoAmbiente(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (!v || v.length < 12) continue;
    if (SUFIXOS_SENSIVEIS.test(k)) out.push(v);
  }
  return out;
}

export function redigir(texto: string, extras: string[] = valoresSensiveisDoAmbiente()): { texto: string; redigiu: boolean } {
  let saida = texto;
  let redigiu = false;
  for (const re of PADROES) {
    re.lastIndex = 0;
    if (re.test(saida)) { redigiu = true; re.lastIndex = 0; saida = saida.replace(re, '[REDIGIDO]'); }
  }
  for (const v of extras) {
    if (saida.includes(v)) { redigiu = true; saida = saida.split(v).join('[REDIGIDO]'); }
  }
  return { texto: saida, redigiu };
}
