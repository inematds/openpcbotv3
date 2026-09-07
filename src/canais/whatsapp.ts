// WhatsApp: DESLIGADO durante a coexistência. whatsapp-web.js sobe um Chromium
// (centenas de MB) e a sessão do número é UMA — o v2 é o dono dela hoje. Ligar
// aqui roubaria a sessão do v2 e dobraria a RAM. Fica o contrato do adaptador
// e a guarda; a implementação entra na fase 8 (corte), em processo separado
// com restart automático, como o plano exige.
import type { Bus } from '../bus/bus.js';

export interface OpcoesWhatsApp {
  ativo: boolean;
  v2Ativo: () => boolean;
  bus: Bus;
  log: (m: string) => void;
}

export function ligarWhatsApp(o: OpcoesWhatsApp): { ligado: boolean; motivo: string } {
  if (!o.ativo) return { ligado: false, motivo: 'WHATSAPP_ENABLED != 1' };
  if (o.v2Ativo()) {
    o.log('[whatsapp] recusado: v2 ativo é dono da sessão do WhatsApp');
    return { ligado: false, motivo: 'v2 ativo (sessão única do número)' };
  }
  o.log('[whatsapp] adaptador ainda não implementado no v3 (fase 8) — nenhum processo iniciado');
  return { ligado: false, motivo: 'implementação na fase 8 (daemon separado)' };
}
