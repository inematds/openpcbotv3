// Operação local: não liga Telegram, não despacha agentes e não testa ferramentas.
import { montarApp } from '../index.js';
import { comandoJev, ObservadorJev } from '../orquestrador/jev.js';
import { agentesCacheados } from '../orquestrador/agentes.js';
import { skillsCacheadas } from '../orquestrador/skills.js';
import { randomUUID } from 'node:crypto';

const acao=process.argv[2] ?? 'status';
if (!['status','observar','off','teste','historico','relatorio'].includes(acao)) {
  console.error('Uso: npm run jev -- status|observar|off|teste|historico [n]|relatorio dia|semana');process.exit(2);
}
const app=montarApp();
try {
  if (acao==='teste') {
    const chatId='jev-teste-local';
    const anterior=app.prefs.obter(chatId,'jev:modo');
    app.prefs.gravar(chatId,'jev:modo','observar');
    try {
      await new ObservadorJev().observar(app,{
        chatId,traceId:randomUUID(),texto:'Explique em poucas palavras o que é uma variável em programação.',
      },agentesCacheados(),skillsCacheadas(),{rota:'direto',tier:'local',motivo:'Referência manual do exemplo fictício'});
      console.log(comandoJev(app,chatId));
      const r=JSON.parse(app.prefs.obter(chatId,'jev:ultima') ?? '{}');
      if (r.erro || !r.modelo) process.exitCode=1;
    } finally {
      if (anterior===undefined) app.prefs.apagar(chatId,'jev:modo');
      else app.prefs.gravar(chatId,'jev:modo',anterior);
    }
  } else {
    console.log(comandoJev(app,app.cfg.chatPermitido ?? 'http',acao==='status'?'':process.argv.slice(2).join(' ')));
  }
} finally { app.db.close(); }
