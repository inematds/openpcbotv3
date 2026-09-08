// Crons padrão do sistema (idempotentes por nome). O usuário desliga com
// `/cron off <nome>`. Lembretes e indexação rodam sem chat; daily precisa do
// chat permitido.
import type { App } from '../app.js';

export function montarCronPadrao(app: App): void {
  const chat = app.cfg.chatPermitido ?? null;
  const canal = 'telegram';
  const defs = [
    { nome: 'lembretes', expressao: '* * * * *', tarefa: 'lembretes', input: '', sessao: 'isolada' as const, canal, chat_id: null },
    { nome: 'indexar-memoria', expressao: '*/15 * * * *', tarefa: 'indexar', input: '', sessao: 'isolada' as const, canal, chat_id: null },
    { nome: 'ingestao-observados', expressao: '*/30 * * * *', tarefa: 'ingestao', input: '', sessao: 'isolada' as const, canal, chat_id: null },
    // Google: ficam CRIADOS mas desligados — ligar com /cron on depois de
    // autenticar as contas (docs/CONECTORES.md). Sem token, todo tick falharia.
    { nome: 'gmail-ingestao', expressao: '0 */2 * * *', tarefa: 'ingestao:gmail', input: JSON.stringify({ horas: 3 }), sessao: 'isolada' as const, canal, chat_id: chat },
    { nome: 'agenda-ingestao', expressao: '5 7 * * *', tarefa: 'ingestao:agenda', input: JSON.stringify({ dias: 14 }), sessao: 'isolada' as const, canal, chat_id: chat },
    { nome: 'decaimento', expressao: '30 3 * * *', tarefa: 'decair', input: '', sessao: 'isolada' as const, canal, chat_id: null },
    { nome: 'consolidacao-noturna', expressao: '0 4 * * *', tarefa: 'consolidacao', input: '', sessao: 'isolada' as const, canal, chat_id: null },
    { nome: 'backup-noturno', expressao: '15 4 * * *', tarefa: 'backup', input: '', sessao: 'isolada' as const, canal, chat_id: null },
    ...(chat ? [{ nome: 'daily-8h', expressao: '0 8 * * *', tarefa: 'cron:comando', input: '/daily', sessao: 'principal' as const, canal, chat_id: chat }] : []),
  ];
  const existentes = new Set(app.cron.listar().map((c) => c.nome));
  const desligados = new Set(['gmail-ingestao', 'agenda-ingestao']);
  for (const d of defs) {
    if (existentes.has(d.nome)) continue;
    app.cron.definir(d);
    if (desligados.has(d.nome)) app.cron.ativar(d.nome, false);
  }
}
