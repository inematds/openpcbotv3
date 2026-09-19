import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { aplicarMigrations } from '../db/migrations.js';
import { Prefs } from '../config/prefs.js';
import { ObservadorJev, comandoJev, pedidoRoteamentoJev } from './jev.js';
import type { Agente } from './agentes.js';
import type { SkillInfo } from './skills.js';
const agentes=[{id:'lead',nome:'Lead',descricao:'Código e arquivos',somenteLeitura:false}] as Agente[];
const skills=[{id:'codigo',name:'Código',description:'Editar código',rascunho:false},{id:'rascunho',name:'Rascunho',description:'Não usar',rascunho:true}] as SkillInfo[];
function montar(){
  const db=new Database(':memory:');aplicarMigrations(db,()=>100);
  const prefs=new Prefs(db,()=>100);
  const gateway={decidirJev:vi.fn(async()=>({modelo:'jev-real',tokensIn:100,tokensOut:10,custoUsdInformado:.0000042,latenciaMs:20,answers:{
    rota:{choice:'agente:lead',confidence:.95,probabilities:{'agente:lead':.95,direto:.04,incerto:.01}},
    skill:{choice:'skill:codigo',confidence:.95,probabilities:{'skill:codigo':.95,nenhuma:.04,incerto:.01}},
  }}))};
  return {db,app:{prefs,gateway,agora:()=>100,log:vi.fn(),cfg:{openrouterKey:'test-key'}},o:new ObservadorJev(),m:{texto:'Crie um arquivo de exemplo',chatId:'teste',traceId:'t'},atual:{rota:'direto' as const,tier:'local' as const,motivo:'exemplo'}};
}
describe('Jev em observação',()=>{
  it('catálogo contém somente ids existentes, sem prompts ou rascunhos',()=>{
    const p=pedidoRoteamentoJev('texto',agentes,skills);
    expect(Object.keys(p.questions.rota.criteria)).toEqual(['direto','incerto','agente:lead']);
    expect(Object.keys(p.questions.skill.criteria)).toEqual(['nenhuma','incerto','skill:codigo']);
    expect(p.state).toEqual({mensagem:'texto'});
  });
  it('desligado não chama API; ativação é isolada por chat',async()=>{
    const {app,o,m,atual,db}=montar();try{
      comandoJev(app as any,'outro','observar');
      await o.observar(app as any,m,agentes,skills,atual);expect(app.gateway.decidirJev).not.toHaveBeenCalled();
    }finally{db.close();}
  });
  it('registra discordância sem modificar decisão ou guardar mensagem; limita frequência',async()=>{
    const {app,o,m,atual,db}=montar();try{
      comandoJev(app as any,m.chatId,'observar');const antes=JSON.stringify(atual);
      await o.observar(app as any,m,agentes,skills,atual);
      const raw=app.prefs.obter(m.chatId,'jev:ultima')!;const r=JSON.parse(raw);
      expect(r).toMatchObject({concorda:false,sugestao:'agente:lead',revisar:false});
      expect(raw).not.toContain(m.texto);expect(JSON.stringify(atual)).toBe(antes);
      await o.observar(app as any,m,agentes,skills,atual);expect(app.gateway.decidirJev).toHaveBeenCalledTimes(1);
    }finally{db.close();}
  });
  it('erro preserva rota e marca custo desconhecido',async()=>{
    const {app,o,m,atual,db}=montar();try{
      app.prefs.gravar(m.chatId,'jev:modo','observar');app.gateway.decidirJev.mockRejectedValue(new Error('segredo'));
      await o.observar(app as any,m,agentes,skills,atual);
      expect(JSON.parse(app.prefs.obter(m.chatId,'jev:ultima')!)).toMatchObject({revisar:true,custoUsd:null,rotaAtual:'direto'});
      expect(app.prefs.obter(m.chatId,'jev:ultima')).not.toContain('segredo');
    }finally{db.close();}
  });
  it('mensagens com token detectado não saem',async()=>{
    const {app,o,m,atual,db}=montar();try{
      app.prefs.gravar(m.chatId,'jev:modo','observar');m.texto='Use sk-or-v1-'+ 'a'.repeat(40);
      await o.observar(app as any,m,agentes,skills,atual);expect(app.gateway.decidirJev).not.toHaveBeenCalled();
    }finally{db.close();}
  });
  it('uma observação em voo impede novas chamadas, mesmo de outro chat',async()=>{
    const {app,o,m,atual,db}=montar();try{
      app.prefs.gravar('*','jev:modo','observar');let liberar!:()=>void;
      const resultado=await app.gateway.decidirJev();app.gateway.decidirJev.mockClear();
      app.gateway.decidirJev.mockImplementationOnce(async()=>{await new Promise<void>(r=>liberar=r);return resultado;});
      const primeira=o.observar(app as any,m,agentes,skills,atual);
      await o.observar(app as any,{...m,chatId:'outro'},agentes,skills,atual);
      expect(app.gateway.decidirJev).toHaveBeenCalledTimes(1);liberar();await primeira;
    }finally{db.close();}
  });
  it('confiança baixa exige revisão; off interrompe novas consultas',async()=>{
    const {app,o,m,atual,db}=montar();try{
      comandoJev(app as any,m.chatId,'observar');const resultado=await app.gateway.decidirJev();resultado.answers.rota.confidence=.2;app.gateway.decidirJev.mockResolvedValue(resultado);
      await o.observar(app as any,m,agentes,skills,atual);expect(JSON.parse(app.prefs.obter(m.chatId,'jev:ultima')!).revisar).toBe(true);
      comandoJev(app as any,m.chatId,'off');app.gateway.decidirJev.mockClear();
      await o.observar(app as any,m,agentes,skills,atual);expect(app.gateway.decidirJev).not.toHaveBeenCalled();
    }finally{db.close();}
  });
});
