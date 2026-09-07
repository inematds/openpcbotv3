// Alertas com dedupe por chave e cooldown: Ollama fora, RAM baixa, job falhou
// 3×, orçamento a 70 %, OAuth expirado. Entregues no chat permitido via bus e
// sempre no log.
import type { Bus, Alerta } from '../bus/bus.js';

export class Alertas {
  private readonly ultimo = new Map<string, number>();

  constructor(
    private readonly bus: Bus,
    private readonly destino: { canal: 'telegram' | 'cli'; chatId: string } | null,
    private readonly log: (m: string) => void,
    private readonly agora: () => number = () => Math.floor(Date.now() / 1000),
    private readonly cooldownSeg = 1800,
  ) {}

  disparar(a: Alerta): boolean {
    const t = this.agora();
    const antes = this.ultimo.get(a.chave);
    if (antes !== undefined && t - antes < this.cooldownSeg) return false;
    this.ultimo.set(a.chave, t);
    const icone = a.nivel === 'erro' ? '🔴' : a.nivel === 'aviso' ? '🟡' : 'ℹ️';
    this.log(`[alerta:${a.nivel}] ${a.chave}: ${a.texto}`);
    this.bus.emit('alerta', a);
    if (this.destino) {
      this.bus.emit('mensagem.enviar', { canal: this.destino.canal, chatId: this.destino.chatId, texto: `${icone} ${a.texto}` });
    }
    return true;
  }

  /** Limpa o cooldown quando a condição normalizou (para avisar de novo se voltar). */
  resolver(chave: string): void {
    this.ultimo.delete(chave);
  }
}
