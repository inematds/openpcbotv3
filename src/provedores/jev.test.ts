import { describe, expect, it, vi } from 'vitest';
import { consultarJev, validarRespostaJev, type PedidoJev } from './jev.js';
const pedido: PedidoJev = { state:{mensagem:'pedido fictício'}, questions:{rota:{type:'choice',instructions:'Escolha',criteria:{direto:'Resposta direta',incerto:'Dados insuficientes'}}} };
const resposta=() => ({model:'typesafe/jev-1.13-20260917',answers:{rota:{type:'choice',choice:'direto',confidence:.95,probabilities:{direto:.95,incerto:.05}}},usage:{input_tokens:100,output_tokens:20,cost:.0000042}});
describe('provedor Jev',()=>{
  it('usa Decisions API e preserva modelo e custo reais',async()=>{
    const fn=vi.fn(async(url,init)=>{
      expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
      expect(JSON.parse(init.body).model).toBe('~typesafe/jev-latest');
      expect(init.headers.Authorization).toBe('Bearer chave-controlada');
      return new Response(JSON.stringify(resposta()));
    });
    const r=await consultarJev('chave-controlada',pedido,fn as typeof fetch);
    expect(r.custoUsdInformado).toBe(.0000042);expect(r.modelo).toContain('20260917');
  });
  it('recusa rótulos, distribuição, perguntas e custos inválidos',()=>{
    for (const alterar of [
      (r:any)=>r.answers.rota.choice='agente-inventado',
      (r:any)=>r.answers.rota.probabilities.direto=.1,
      (r:any)=>r.answers.rota.confidence=2,
      (r:any)=>delete r.answers.rota,
      (r:any)=>r.usage.cost=-1,
      (r:any)=>delete r.usage.cost,
    ]) {const r=resposta();alterar(r);expect(()=>validarRespostaJev(pedido,r)).toThrow('Jev:');}
  });
  it('HTTP não vaza mensagem nem segredo do provedor e não faz retry',async()=>{
    const fn=vi.fn(async()=>new Response('segredo-controlado',{status:401}));
    await expect(consultarJev('chave',pedido,fn)).rejects.toThrow(/^Jev: HTTP 401$/);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('cancelamento anterior não envia requisição',async()=>{
    const fn=vi.fn();const ctrl=new AbortController();ctrl.abort();
    await expect(consultarJev('chave',{...pedido,sinal:ctrl.signal},fn)).rejects.toThrow('cancelada');expect(fn).not.toHaveBeenCalled();
  });
  it('timeout aborta a chamada',async()=>{
    const fn=vi.fn(async(_url,init)=>new Promise<Response>((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('cancelado')))));
    await expect(consultarJev('chave',{...pedido,timeoutMs:5},fn as typeof fetch)).rejects.toThrow('tempo esgotado');
  });
});
