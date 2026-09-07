// Orçamento mensal com aviso e trava dura (plano §4.6). Só o tier `local`
// passa quando a trava fecha.
import type { ConfigOrcamento } from '../config/yaml.js';
import type { RegistroCusto, Tier } from './registro.js';

export interface DecisaoOrcamento {
  permitido: boolean;
  pct: number;
  gastoUsd: number;
  limiteUsd: number;
  aviso: boolean;
  motivo?: string;
}

export class Orcamento {
  private avisou = false;
  private travou = false;

  constructor(private readonly registro: RegistroCusto, private readonly cfg: ConfigOrcamento) {}

  avaliar(tier: Tier): DecisaoOrcamento {
    const gasto = this.registro.mes().custoUsd;
    const limite = this.cfg.mensal_usd;
    const pct = limite > 0 ? Math.round((gasto / limite) * 1000) / 10 : 0;
    const aviso = pct >= this.cfg.aviso_pct;
    if (tier === 'local') return { permitido: true, pct, gastoUsd: gasto, limiteUsd: limite, aviso };
    if (pct >= this.cfg.trava_pct) {
      return { permitido: false, pct, gastoUsd: gasto, limiteUsd: limite, aviso, motivo: `orçamento mensal esgotado (${pct}% de US$ ${limite})` };
    }
    return { permitido: true, pct, gastoUsd: gasto, limiteUsd: limite, aviso };
  }

  /** Devolve um alerta no máximo UMA vez por transição (70 % e 100 %). */
  alertaPendente(): { chave: string; nivel: 'aviso' | 'erro'; texto: string } | null {
    const d = this.avaliar('barato');
    if (d.pct >= this.cfg.trava_pct && !this.travou) {
      this.travou = true;
      return { chave: 'orcamento.trava', nivel: 'erro', texto: `Orçamento mensal esgotado: US$ ${d.gastoUsd.toFixed(2)} de ${d.limiteUsd}. Só Ollama até o fim do mês.` };
    }
    if (d.aviso && !this.avisou) {
      this.avisou = true;
      return { chave: 'orcamento.aviso', nivel: 'aviso', texto: `Orçamento em ${d.pct}%: US$ ${d.gastoUsd.toFixed(2)} de ${d.limiteUsd}.` };
    }
    if (d.pct < this.cfg.aviso_pct) { this.avisou = false; this.travou = false; }
    return null;
  }

  resumo(): string {
    const d = this.avaliar('barato');
    return `Orçamento: US$ ${d.gastoUsd.toFixed(2)} / ${d.limiteUsd} (${d.pct}%)${d.permitido ? '' : ' — TRAVADO'}`;
  }
}
