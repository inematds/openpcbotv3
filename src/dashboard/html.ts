// Dashboard compacto (uma página, sem build): fila ao vivo, custo por dia e
// por agente, memória, Ollama/RAM, heartbeat. Lê /api/* a cada 10 s.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>openpcbot v3</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0f1115;--card:#171a21;--tx:#e6e6e6;--mut:#8a94a6;--amb:#f5a623;--ok:#3fb950;--err:#f85149}
body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.45 system-ui,sans-serif}
header{padding:14px 20px;border-bottom:1px solid #222;display:flex;gap:16px;align-items:baseline}
h1{font-size:18px;margin:0;color:var(--amb)} .mut{color:var(--mut)}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;padding:16px 20px}
.card{background:var(--card);border:1px solid #232733;border-radius:10px;padding:14px}
.card h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:0 0 10px}
table{width:100%;border-collapse:collapse} td,th{padding:4px 6px;text-align:left;border-bottom:1px solid #22262f} th{color:var(--mut);font-weight:500}
.ok{color:var(--ok)} .err{color:var(--err)} .amb{color:var(--amb)}
.bar{height:8px;background:#22262f;border-radius:4px;overflow:hidden} .bar>i{display:block;height:100%;background:var(--amb)}
.spark{display:flex;gap:2px;align-items:flex-end;height:48px} .spark>i{flex:1;background:var(--amb);opacity:.85;min-height:2px}
pre{white-space:pre-wrap;margin:0;font-size:12px;color:#cfd6e4}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;background:#22262f;font-size:12px;margin-right:4px}
</style></head><body>
<header><h1>openpcbot v3</h1><span id="ver" class="mut"></span><span id="upd" class="mut" style="margin-left:auto"></span></header>
<main>
<section class="card"><h2>Health</h2><div id="health"></div></section>
<section class="card"><h2>Ollama · RAM</h2><div id="ollama"></div></section>
<section class="card"><h2>Fila</h2><div id="fila"></div></section>
<section class="card"><h2>Custo · 14 dias</h2><div id="custo"></div></section>
<section class="card"><h2>Custo por agente · 30 d</h2><div id="agentes"></div></section>
<section class="card"><h2>Memória</h2><div id="memoria"></div></section>
<section class="card" style="grid-column:1/-1"><h2>Jobs recentes</h2><div id="jobs"></div></section>
</main>
<script>
const q=new URLSearchParams(location.search);const tok=q.get('token');
const get=async p=>{const r=await fetch(p+(tok?(p.includes('?')?'&':'?')+'token='+tok:''));return r.json()};
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const usd=v=>'US$ '+Number(v||0).toFixed(3);
const dur=s=>s<3600?Math.round(s/60)+' min':(s/3600).toFixed(1)+' h';
async function tick(){
 try{
 const [h,f,c,m,o]=await Promise.all([get('/api/health'),get('/api/fila'),get('/api/custo'),get('/api/memoria'),get('/api/ollama')]);
 ver.textContent='v'+h.versao+' · '+h.instancia; upd.textContent='atualizado '+new Date().toLocaleTimeString('pt-BR');
 health.innerHTML='<p><b class="'+(h.ok?'ok':'err')+'">'+(h.ok?'OK':'DEGRADADO')+'</b> · up '+dur(h.uptime_s)+' · '+h.rss_mb+' MB RSS</p>'
  +'<p>canais: '+(h.canais.map(x=>'<span class="pill">'+esc(x)+'</span>').join('')||'<span class="mut">nenhum</span>')+'</p>'
  +'<p>heartbeat: '+(h.heartbeat?dur(h.heartbeat.ha_s)+' atrás':'<span class="err">nunca</span>')+'</p>'
  +'<p>orçamento: '+usd(h.orcamento.gasto_usd)+' / '+h.orcamento.limite_usd+' ('+h.orcamento.pct+'%)'+(h.orcamento.travado?' <b class="err">TRAVADO</b>':'')+'</p><div class="bar"><i style="width:'+Math.min(100,h.orcamento.pct)+'%"></i></div>';
 const ram=o.ram||{};const pct=ram.totalGb?Math.round(100*(ram.totalGb-ram.disponivelGb)/ram.totalGb):0;
 ollama.innerHTML='<p>'+(o.online?'<b class="ok">online</b>':'<b class="err">FORA</b> '+esc(o.erro))+' · latência '+(o.latenciaMs??'-')+' ms</p>'
  +'<p>'+(o.carregados&&o.carregados.length?o.carregados.map(x=>'<span class="pill">'+esc(x.name)+' '+Math.round(x.size/1e9)+' GB</span>').join(''):'<span class="mut">nenhum modelo carregado</span>')+'</p>'
  +'<p>RAM usada '+pct+'% · livre <b class="'+(ram.disponivelGb<10?'err':ram.disponivelGb<40?'amb':'ok')+'">'+ram.disponivelGb+' GB</b> de '+ram.totalGb+' · swap '+ram.swapUsadoGb+' GB</p><div class="bar"><i style="width:'+pct+'%"></i></div>';
 fila.innerHTML='<table><tr><th>lane</th><th>rodando</th><th>na fila</th></tr>'+f.lanes.map(l=>'<tr><td>'+l.lane+'</td><td>'+l.running+'</td><td>'+l.queued+'</td></tr>').join('')+'</table>';
 const mx=Math.max(0.001,...c.porDia.map(d=>d.custoUsd));
 custo.innerHTML='<p>hoje '+usd(c.hoje.custoUsd)+' ('+c.hoje.chamadas+') · semana '+usd(c.semana.custoUsd)+' · mês '+usd(c.mes.custoUsd)+'</p><div class="spark">'+c.porDia.map(d=>'<i title="'+d.dia+' '+usd(d.custoUsd)+' ('+d.chamadas+')" style="height:'+Math.max(4,Math.round(100*d.custoUsd/mx))+'%"></i>').join('')+'</div>'
  +'<table>'+c.porTier.map(t=>'<tr><td>'+esc(t.tier)+'</td><td>'+t.chamadas+'</td><td>'+(t.tokensIn+t.tokensOut)+' tok</td><td>'+usd(t.custoUsd)+'</td></tr>').join('')+'</table>';
 agentes.innerHTML='<table>'+(c.porAgente.map(a=>'<tr><td>'+esc(a.agente)+'</td><td>'+a.chamadas+'</td><td>'+usd(a.custoUsd)+'</td></tr>').join('')||'<tr><td class="mut">sem chamadas</td></tr>')+'</table>';
 memoria.innerHTML='<p>'+m.contagem.total+' memórias · '+m.contagem.semanticas+' semânticas · '+m.contagem.episodicas+' episódicas</p>'
  +'<p class="mut">mais importantes</p><pre>'+esc(m.importantes.map(x=>'• '+x.content.slice(0,100)+' ('+x.salience.toFixed(2)+')').join('\\n')||'-')+'</pre>'
  +(m.insights.length?'<p class="mut">insights</p><pre>'+esc(m.insights.map(x=>'• '+x.texto).join('\\n'))+'</pre>':'')
  +(m.propostas.length?'<p class="amb">'+m.propostas.length+' proposta(s) de vault pendentes</p>':'');
 jobs.innerHTML='<table><tr><th>#</th><th>lane/tarefa</th><th>status</th><th>tent.</th><th>início</th><th>erro/resultado</th></tr>'+f.recentes.slice().reverse().map(j=>'<tr><td>'+j.id+'</td><td>'+esc(j.fila+'/'+j.tarefa)+'</td><td class="'+(j.status==='failed'?'err':j.status==='done'?'ok':'amb')+'">'+j.status+'</td><td>'+j.tentativas+'/'+j.max_tentativas+'</td><td>'+(j.iniciado_em?new Date(j.iniciado_em*1000).toLocaleTimeString('pt-BR'):'-')+'</td><td class="mut">'+esc((j.erro||j.resultado||'').slice(0,90))+'</td></tr>').join('')+'</table>';
 }catch(e){upd.textContent='erro: '+e.message}
}
tick();setInterval(tick,10000);
</script></body></html>`;
