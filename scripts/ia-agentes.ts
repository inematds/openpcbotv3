// Leitura/validação local. Não carrega .env, não autentica nem chama modelos.
import { lerAgentesIA } from '../src/config/agentes-ia.js';
const cmd = process.argv[2] ?? 'ver';
if (!['ver', 'validar'].includes(cmd)) {
  console.error('Uso: npm run ia -- ver|validar'); process.exit(1);
}
const c = lerAgentesIA();
console.log(cmd === 'validar' ? 'Configuração válida (somente assinaturas; não verifica login/cota).' : JSON.stringify(c, null, 2));
