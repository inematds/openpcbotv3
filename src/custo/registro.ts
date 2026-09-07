// Registro de chamadas de LLM (tabela `chamadas_llm`) e consultas do /usage.
import type Database from 'better-sqlite3';

export type Tier = 'local' | 'barato' | 'premium';

export interface ChamadaLLM {
  traceId?: string;
  provedor: string;
  modelo: string;
  tier: Tier;
  agente?: string;
  jobId?: number;
  chatId?: string;
  tokensIn: number;
  tokensOut: number;
  tokensCache?: number;
  custoUsd: number;
  latenciaMs: number;
  ok: boolean;
  erro?: string;
  motivoTier?: string;
}

export interface ResumoUso {
  chamadas: number;
  tokensIn: number;
  tokensOut: number;
  custoUsd: number;
}

export class RegistroCusto {
  constructor(private readonly db: Database.Database, private readonly agora: () => number) {}

  gravar(c: ChamadaLLM): number {
    const r = this.db.prepare(
      `INSERT INTO chamadas_llm (trace_id, provedor, modelo, tier, agente, job_id, chat_id, tokens_in, tokens_out,
         tokens_cache, custo_usd, latencia_ms, ok, erro, motivo_tier, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      c.traceId ?? null, c.provedor, c.modelo, c.tier, c.agente ?? null, c.jobId ?? null, c.chatId ?? null,
      c.tokensIn, c.tokensOut, c.tokensCache ?? 0, c.custoUsd, c.latenciaMs, c.ok ? 1 : 0,
      c.erro ?? null, c.motivoTier ?? null, this.agora(),
    );
    return Number(r.lastInsertRowid);
  }

  private soma(desde: number, extra = '', args: unknown[] = []): ResumoUso {
    const l = this.db.prepare(
      `SELECT COUNT(*) AS chamadas, COALESCE(SUM(tokens_in),0) AS tokensIn, COALESCE(SUM(tokens_out),0) AS tokensOut,
              COALESCE(SUM(custo_usd),0) AS custoUsd
         FROM chamadas_llm WHERE created_at >= ? ${extra}`,
    ).get(desde, ...args) as ResumoUso;
    return l;
  }

  /** Início do dia/semana/mês em segundos epoch, no fuso local do processo. */
  static inicios(agora: number): { hoje: number; semana: number; mes: number } {
    const d = new Date(agora * 1000);
    const hoje = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
    const semana = hoje - ((d.getDay() + 6) % 7) * 86400;
    const mes = new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000;
    return { hoje, semana, mes };
  }

  hoje(): ResumoUso { return this.soma(RegistroCusto.inicios(this.agora()).hoje); }
  semana(): ResumoUso { return this.soma(RegistroCusto.inicios(this.agora()).semana); }
  mes(): ResumoUso { return this.soma(RegistroCusto.inicios(this.agora()).mes); }

  porAgente(desde: number): { agente: string; custoUsd: number; chamadas: number }[] {
    return this.db.prepare(
      `SELECT COALESCE(agente,'-') AS agente, SUM(custo_usd) AS custoUsd, COUNT(*) AS chamadas
         FROM chamadas_llm WHERE created_at >= ? GROUP BY agente ORDER BY custoUsd DESC`,
    ).all(desde) as { agente: string; custoUsd: number; chamadas: number }[];
  }

  porTier(desde: number): { tier: string; custoUsd: number; chamadas: number; tokensIn: number; tokensOut: number }[] {
    return this.db.prepare(
      `SELECT tier, SUM(custo_usd) AS custoUsd, COUNT(*) AS chamadas, SUM(tokens_in) AS tokensIn, SUM(tokens_out) AS tokensOut
         FROM chamadas_llm WHERE created_at >= ? GROUP BY tier ORDER BY custoUsd DESC`,
    ).all(desde) as { tier: string; custoUsd: number; chamadas: number; tokensIn: number; tokensOut: number }[];
  }

  /** Série por dia (para o dashboard), últimos `dias`. */
  porDia(dias = 14): { dia: string; custoUsd: number; chamadas: number }[] {
    const desde = this.agora() - dias * 86400;
    return this.db.prepare(
      `SELECT date(created_at, 'unixepoch', 'localtime') AS dia, SUM(custo_usd) AS custoUsd, COUNT(*) AS chamadas
         FROM chamadas_llm WHERE created_at >= ? GROUP BY dia ORDER BY dia`,
    ).all(desde) as { dia: string; custoUsd: number; chamadas: number }[];
  }
}
