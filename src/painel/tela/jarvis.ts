// Versão JARVIS do painel (3.14.7): o visual HUD do kit jarvis-painel (núcleo com
// anéis, partida "bom dia", voz em português, barra de comando) com os dados de
// verdade do /api/painel. Mesmo login e mesmas rotas de dados do painel clássico;
// só lê — Aprovar/Depois marcam apenas neste navegador.
// Sem template literal dentro do JS: o arquivo é String.raw (crase e "${" quebrariam calados).

const JARVIS_CSS = String.raw`
:root{--bg:#040a17;--painel:rgba(10,28,58,.62);--linha:rgba(95,227,255,.22);--ciano:#5fe3ff;--ciano2:#2bb8e6;--gelo:#e8f7ff;--mut:#8fb2c9;--alerta:#ffb020;--erro:#ff5d6c;
  --mono:ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,Inter,sans-serif}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:radial-gradient(ellipse at 50% 40%,#0b2148 0%,var(--bg) 62%) fixed,var(--bg);color:var(--gelo);font:15px/1.45 var(--sans);overflow-x:hidden;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(95,227,255,.035) 0 1px,transparent 1px 3px);z-index:0}
.app{position:relative;z-index:1;display:grid;grid-template-rows:auto 1fr auto;min-height:100vh;max-width:1700px;margin:0 auto;padding:14px 18px 16px;gap:14px}
header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--linha);padding-bottom:10px}
.marca{font:700 13px var(--mono);letter-spacing:.32em;color:var(--ciano)}
.ver{font:11px var(--mono);color:var(--mut)}
.relogio{margin-left:auto;font:600 22px var(--mono);letter-spacing:.06em}
.data{font:12px var(--mono);color:var(--mut);letter-spacing:.12em;text-transform:uppercase}
.selo{font:600 11px var(--mono);letter-spacing:.16em;text-transform:uppercase;border:1px solid var(--linha);color:var(--ciano);background:transparent;border-radius:999px;padding:6px 12px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;min-height:32px}
.selo.desl{color:var(--mut)}.selo:hover{border-color:var(--ciano)}
form.in{display:inline;margin:0}
button:focus-visible,a:focus-visible{outline:2px solid var(--ciano);outline-offset:2px}
main{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,1.05fr) minmax(0,1fr);gap:16px;align-items:stretch;min-height:0}
.painel{background:var(--painel);border:1px solid var(--linha);border-radius:14px;padding:14px 14px 10px;display:flex;flex-direction:column;min-height:0;max-height:calc(100vh - 230px);transition:opacity .5s;position:relative}
.painel::after{content:"";position:absolute;top:-1px;left:16px;width:56px;height:2px;background:var(--ciano);box-shadow:0 0 12px var(--ciano)}
.painel h2{margin:0 0 4px;font:700 12px var(--mono);letter-spacing:.24em;text-transform:uppercase;color:var(--ciano)}
.painel h3{margin:12px 0 2px;font:700 11px var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--mut)}
.painel .sub{margin:0 0 8px;font-size:12px;color:var(--mut)}
.rolar{overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--ciano2) transparent;padding-right:4px}
.lista{list-style:none;margin:0;padding:0}
.lista li{display:grid;grid-template-columns:12px minmax(0,1fr) auto;gap:2px 10px;align-items:start;padding:8px 2px;border-bottom:1px solid rgba(95,227,255,.09)}
.ponto{width:9px;height:9px;border-radius:50%;margin-top:6px;background:var(--ciano);box-shadow:0 0 8px var(--ciano)}
.ponto.erro{background:var(--erro);box-shadow:0 0 10px var(--erro);animation:pisca 1.2s infinite}
.ponto.aviso{background:var(--alerta);box-shadow:0 0 10px var(--alerta)}
.ponto.rodando{background:#fff;box-shadow:0 0 10px #fff;animation:pisca .8s infinite}
.ponto.semdados,.ponto.info{background:transparent;border:1px solid var(--mut);box-shadow:none}
@keyframes pisca{50%{opacity:.35}}
.nome{font:600 13px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acao{grid-column:2/4;font-size:12px;color:var(--mut);overflow-wrap:anywhere}
.rot{font:600 12px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--mut);white-space:nowrap}
.rot.erro{color:var(--erro)}.rot.aviso{color:var(--alerta)}
.esp li{grid-template-columns:12px minmax(0,1fr);gap:6px 10px}
.esp .titulo{font-size:13px;overflow-wrap:anywhere}.esp .titulo.erro{color:var(--erro)}.esp .titulo.aviso{color:var(--alerta)}
.esp .botoes{grid-column:2;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.esp button{font:600 11px var(--mono);letter-spacing:.1em;text-transform:uppercase;background:transparent;color:var(--ciano);border:1px solid var(--linha);border-radius:8px;padding:5px 10px;cursor:pointer;min-height:30px}
.esp button:hover{border-color:var(--ciano);background:rgba(95,227,255,.08)}
.esp li.marcado{opacity:.45}.esp .marca-tela{font:11px var(--mono);color:var(--mut)}
.aviso-rod{font-size:12px;color:var(--mut);border-top:1px solid var(--linha);margin:8px 0 0;padding-top:8px}
.nucleo{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:380px}
#cv{width:100%;max-width:520px;aspect-ratio:1/1;display:block}
.centro{position:absolute;inset:0;bottom:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;text-align:center}
.centro .nomeia{font:800 clamp(20px,2.5vw,34px) var(--mono);letter-spacing:.34em;margin-right:-.34em;text-shadow:0 0 18px var(--ciano)}
.centro .status{margin-top:8px;font:12px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ciano);max-width:48%}
.contas{display:flex;gap:18px;justify-content:center;flex-wrap:wrap;margin-top:6px;font:12px var(--mono);color:var(--mut)}
.contas b{color:var(--gelo);font-size:15px}.contas .al b{color:var(--alerta)}.contas .er b{color:var(--erro)}
footer{display:grid;gap:10px}
.resposta{min-height:3em;font:15px/1.5 var(--mono);border-left:2px solid var(--ciano);padding:4px 0 4px 12px;overflow-wrap:anywhere}
.resposta .cursor{display:inline-block;width:.55em;height:1.05em;background:var(--ciano);vertical-align:-2px;animation:pisca 1s infinite}
.barra{display:flex;gap:10px;flex-wrap:wrap;align-items:center;border:1px solid var(--linha);border-radius:12px;padding:8px;background:rgba(6,18,40,.7)}
.barra .pr{font:700 12px var(--mono);color:var(--ciano);padding:0 6px;letter-spacing:.2em}
.barra button{flex:1 1 140px;font:600 13px var(--sans);color:var(--gelo);background:rgba(95,227,255,.07);border:1px solid var(--linha);border-radius:10px;padding:11px 12px;cursor:pointer;min-height:44px}
.barra button:hover,.barra button.on{border-color:var(--ciano);background:rgba(95,227,255,.16);box-shadow:0 0 14px rgba(95,227,255,.25) inset}
.barra kbd{font:11px var(--mono);color:var(--mut);margin-left:6px}
body.foco .painel{opacity:.15}body.foco .painel:hover{opacity:.9}
#partida{position:fixed;inset:0;z-index:10;background:rgba(4,10,23,.35);display:flex;align-items:flex-end;justify-content:center;padding-bottom:14vh;transition:opacity .6s;pointer-events:none}
body.partindo .painel,body.partindo footer,body.partindo .contas,body.partindo header{opacity:0}
header,footer,.contas{transition:opacity .8s}
#partida.fim{opacity:0}
#partida pre{font:16px/1.9 var(--mono);text-shadow:0 0 12px #000;color:var(--ciano);margin:0;padding:0 20px;white-space:pre-wrap;max-width:100%}
@media (max-width:980px){main{grid-template-columns:minmax(0,1fr)}.nucleo{order:-1;min-height:0}#cv{max-width:340px}.painel{max-height:none}.rolar{max-height:60vh}.relogio{font-size:18px}.app{padding:12px 16px 14px}
  footer{position:sticky;bottom:0;z-index:5;margin:0 -16px -14px;padding:10px 16px 12px;background:var(--bg);box-shadow:0 -18px 18px var(--bg)}
  .resposta{min-height:0;max-height:6.2em;overflow-y:auto;font-size:14px}.barra button{flex:1 1 40%;padding:9px 8px;font-size:13px}}
@media (prefers-reduced-motion:reduce){.ponto.erro,.ponto.rodando,.resposta .cursor{animation:none}}
`;

/** JS do cliente (exportado para o teste de sintaxe e de resumo). */
export const JARVIS_JS = String.raw`(function(){'use strict';
var $=function(id){return document.getElementById(id)};
var LS={get:function(k,d){try{var v=localStorage.getItem(k);return v===null?d:v}catch(e){return d}},set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
var REDUZ=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var NOME='Nei';
var D=null,falando=false,ondaAte=0,vozLigada=LS.get('jarvis.voz','1')==='1',marcas={},falados={},primeira=true,partiu=false;
try{marcas=JSON.parse(LS.get('jarvis.marcas','{}'))||{}}catch(e){marcas={}}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function n(v,c){return v==null||isNaN(v)?'–':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:c==null?1:c})}
function hm(t){return t?new Date(t*1000).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'–'}
function ha(t){if(!t)return'ainda não rodou';var s=Date.now()/1000-t;if(s<0)return'agora';if(s<90)return'há 1 min';if(s<3600)return'há '+Math.round(s/60)+' min';if(s<86400)return'há '+Math.round(s/3600)+' h';return'há '+Math.round(s/86400)+' d'}
function plural(q,um,varios){return q+' '+(q===1?um:varios)}
function idDe(s){s=String(s);var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return'i'+h.toString(36)}
var NOMES={maquina:'Máquina',bots:'Bots',producao:'Produção',publicacao:'Publicação',creditos:'Créditos',sites:'Sites',vagas:'Vagas',terminais:'Terminais'};
var ROT={ok:'ok',erro:'erro',aviso:'atenção',semdados:'sem dados',rodando:'rodando'};
function estadoGrupo(nome,g,al){if(!g||!g.ok)return'semdados';var e=al.filter(function(a){return a.grupo===nome});if(e.some(function(a){return a.nivel==='erro'}))return'erro';if(e.length)return'aviso';return'ok'}
// Uma frase curta por sistema, a partir dos dados de cada grupo.
var FRASE={
  maquina:function(d){var m=d.memoria||{},k=d.disco||{},o=d.gpu_oom||{};return n(m.disponivel_gb,0)+' GB livres · disco '+n(k.usado_pct,0)+'% · GPU sem memória 24 h: '+n(o.ultimas_24h,0)},
  bots:function(d){var v=(d.v3&&d.v3.jobs)||{},f=((d.v3&&d.v3.falhas_24h)||[]).length,s=d.servicos||{},caidos=Object.keys(s).filter(function(k){return s[k]!=='active'});
    return'v3: '+n(v.rodando,0)+' rodando, '+n(v.na_fila,0)+' na fila, '+plural(f,'falha','falhas')+' em 24 h'+(caidos.length?' · parado: '+caidos.join(', '):'')},
  producao:function(d){var h=d.hoje||[],p=(d.presas||[]).length,f=(d.falhas||[]).length,prox=(d.timers||[]).filter(function(t){return t.proxima}).sort(function(a,b){return a.proxima-b.proxima}).filter(function(t){return!/watchdog|vigia|ocioso|continua|-producao$/.test(t.unidade)})[0];
    return plural(h.length,'rodada','rodadas')+' hoje · '+p+' presas · '+f+' falhas'+(prox?' · próxima: '+prox.unidade+' às '+hm(prox.proxima):'')},
  publicacao:function(d){var s=d.semana_por_canal||{},t=0;Object.keys(s).forEach(function(k){t+=s[k]});return plural(d.hoje||0,'vídeo','vídeos')+' hoje · '+t+' na semana'},
  creditos:function(d){var c=(d.claude&&d.claude.limites)||[],x=d.codex||{};return c.map(function(l){return String(l.nome).replace(/^Semana \(todos\)$/,'Claude semana').replace(/^Semana · /,'')+' '+n(l.pct,0)+'%'}).join(' · ')+(x.pct!=null?' · Codex '+n(x.pct,0)+'%':'')},
  sites:function(d){if(d.desligado)return'checagem desligada';var s=d.sites||[];if(!s.length)return d.checando?'checando agora…':'sem leitura ainda';var ok=s.filter(function(x){return x.ok}).length,ruins=s.filter(function(x){return!x.ok}).map(function(x){return String(x.url).replace(/^https?:\/\//,'')});return ok+' de '+s.length+' no ar'+(ruins.length?' · fora: '+ruins.join(', '):'')},
  vagas:function(d){return(d.classes||[]).filter(function(c){return c.ocupadas||c.esperando||c.classe==='gpu'||c.classe==='render'}).map(function(c){return c.classe+' '+c.ocupadas+'/'+c.vagas+(c.dono?' ('+c.dono+')':'')+(c.esperando?' +'+c.esperando+' esperando':'')}).join(' · ')},
  terminais:function(d){return plural((d.vivos||[]).length,'sessão viva','sessões vivas')+' · '+plural((d.interrompidos||[]).length,'interrompida','interrompidas')}
};
function sistemas(){var al=D.alertas||[];return Object.keys(NOMES).map(function(nome){var g=D.grupos[nome],st=estadoGrupo(nome,g,al),fr;
  try{fr=g&&g.ok?FRASE[nome](g.dados||{}):(g&&g.erro)||'fonte ausente'}catch(e){fr='não consegui ler: '+e.message}
  if(st==='ok'&&nome==='vagas'&&g&&g.dados&&(g.dados.classes||[]).some(function(c){return c.ocupadas}))st='rodando';
  return{nome:nome,estado:st,frase:fr}})}
function esperando(){var it=(D.grupos.esperando&&D.grupos.esperando.ok&&D.grupos.esperando.dados.itens)||[],vistos={},out=[];
  (D.alertas||[]).concat(it).forEach(function(x){var k=x.texto;if(vistos[k])return;vistos[k]=1;out.push({id:idDe(k),texto:k,nivel:x.nivel||'info',tipo:x.tipo||'alerta'})});
  var ordem={erro:0,aviso:1,info:2};out.sort(function(a,b){return(ordem[a.nivel]-ordem[b.nivel])});return out}
function contagem(){var al=D.alertas||[],er=al.filter(function(a){return a.nivel==='erro'}).length,pub=(D.grupos.publicacao&&D.grupos.publicacao.dados&&D.grupos.publicacao.dados.hoje)||0;
  var v=(D.grupos.vagas&&D.grupos.vagas.dados&&D.grupos.vagas.dados.classes)||[],oc=0;v.forEach(function(c){oc+=c.ocupadas||0});
  var sis=sistemas();return{erros:er,avisos:al.length-er,publicados:pub,ocupadas:oc,ok:sis.filter(function(s){return s.estado==='ok'||s.estado==='rodando'}).length,total:sis.length,abertos:esperando().filter(function(x){return!marcas[x.id]}).length}}
function desenhar(){if(!D)return;var c=contagem(),sis=sistemas(),ordem={erro:0,aviso:1,rodando:2,ok:3,semdados:4};
  $('ver').textContent='v'+D.versao+' · leitura '+hm(D.gerado_em);
  $('subSis').textContent=c.total+' sistemas · '+c.ok+' ok'+(c.erros?' · '+plural(c.erros,'erro','erros'):'')+(c.avisos?' · '+plural(c.avisos,'aviso','avisos'):'');
  $('listaSis').innerHTML=sis.slice().sort(function(a,b){return ordem[a.estado]-ordem[b.estado]}).map(function(s){return'<li><span class="ponto '+s.estado+'" aria-hidden="true"></span><span class="nome">'+esc(NOMES[s.nome])+'</span><span class="rot '+s.estado+'">'+ROT[s.estado]+'</span><span class="acao">'+esc(s.frase)+'</span></li>'}).join('');
  var tm=(D.grupos.producao&&D.grupos.producao.dados&&D.grupos.producao.dados.timers)||[],agora=Date.now()/1000;
  $('listaTim').innerHTML=tm.filter(function(t){return t.proxima&&t.proxima>agora-60&&!/watchdog|vigia|ocioso|^continua$|-producao$/.test(t.unidade)}).sort(function(a,b){return a.proxima-b.proxima}).slice(0,8).map(function(t){return'<li><span class="ponto info" aria-hidden="true"></span><span class="nome">'+esc(t.unidade)+'</span><span class="rot">'+hm(t.proxima)+'</span><span class="acao">última: '+esc(t.ultima?ha(t.ultima):'ainda não rodou')+'</span></li>'}).join('')||'<li><span></span><span class="acao">nenhum timer à vista</span></li>';
  var ult=(D.grupos.publicacao&&D.grupos.publicacao.dados&&D.grupos.publicacao.dados.ultimos)||[];
  $('listaPub').innerHTML=ult.slice(0,5).map(function(u){return'<li><span class="ponto" aria-hidden="true"></span><span class="nome" title="'+esc(u.titulo)+'">'+esc(u.titulo||u.video_id)+'</span><span class="rot">'+esc(u.canal)+'</span><span class="acao">'+ha(u.quando)+'</span></li>'}).join('')||'<li><span></span><span class="acao">nada publicado ainda</span></li>';
  var esp=esperando();$('subEsp').textContent=plural(c.abertos,'aberto','abertos')+' · '+plural(esp.length-c.abertos,'marcado','marcados')+' na tela';
  $('listaEsp').innerHTML=esp.map(function(x){var m=marcas[x.id];return'<li class="'+(m?'marcado':'')+'"><span class="ponto '+x.nivel+'" aria-hidden="true"></span><span class="titulo '+x.nivel+'">'+esc(x.texto)+'</span><span class="botoes">'+(m?'<span class="marca-tela">'+(m==='aprovado'?'Visto':'Depois')+' (só na tela)</span><button type="button" data-id="'+x.id+'" data-m="">Desfazer</button>':'<button type="button" data-id="'+x.id+'" data-m="aprovado">Visto</button><button type="button" data-id="'+x.id+'" data-m="depois">Depois</button>')+'</span></li>'}).join('')||'<li><span></span><span class="titulo">Nada esperando você.</span></li>';
  $('contas').innerHTML='<span class="'+(c.erros?'er':'')+'"><b>'+c.erros+'</b> erros</span><span class="al"><b>'+c.avisos+'</b> avisos</span><span><b>'+c.publicados+'</b> publicados hoje</span><span><b>'+c.ocupadas+'</b> vagas ocupadas</span>';
  if(!falando&&partiu)$('status').textContent=c.erros?plural(c.erros,'erro','erros')+' pedindo atenção':c.avisos?plural(c.avisos,'aviso','avisos'):'tudo em ordem';
  var sair=$('sair'),ss=D.sessao;if(sair)sair.hidden=!ss||ss.via!=='senha'}
$('listaEsp').addEventListener('click',function(ev){var b=ev.target.closest('button[data-id]');if(!b)return;if(b.dataset.m)marcas[b.dataset.id]=b.dataset.m;else delete marcas[b.dataset.id];LS.set('jarvis.marcas',JSON.stringify(marcas));desenhar()});
// ---------- fala ----------
var vozPt=null;function acharVoz(){var vs=(window.speechSynthesis&&speechSynthesis.getVoices())||[];vozPt=vs.filter(function(v){return/pt[-_]BR/i.test(v.lang)})[0]||vs.filter(function(v){return/^pt/i.test(v.lang)})[0]||null}
if(window.speechSynthesis){acharVoz();speechSynthesis.onvoiceschanged=acharVoz}
var digitando=0;function digitar(texto){var alvo=$('resposta'),id=++digitando,i=0;if(REDUZ){alvo.textContent=texto;return}
  (function passo(){if(id!==digitando)return;i=Math.min(texto.length,i+2);alvo.innerHTML=esc(texto.slice(0,i))+'<span class="cursor"></span>';if(i<texto.length)setTimeout(passo,18)})()}
function falar(texto,rotulo){digitar(texto);ondaAte=performance.now()+Math.min(9000,9*texto.length+600);$('status').textContent=rotulo||'falando';
  var fim=function(){falando=false;desenhar()};
  if(!vozLigada||!window.speechSynthesis){falando=true;setTimeout(fim,Math.min(6000,60*texto.length));return}
  try{speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(texto);u.lang='pt-BR';if(vozPt)u.voice=vozPt;u.rate=1.02;
    var vigia=setTimeout(fim,Math.max(4000,90*texto.length));u.onend=u.onerror=function(){clearTimeout(vigia);fim()};falando=true;speechSynthesis.speak(u)}catch(e){fim()}}
function saudacao(){var h=new Date().getHours();return h<5?'Boa madrugada':h<12?'Bom dia':h<18?'Boa tarde':'Boa noite'}
function textoBomDia(){var c=contagem(),esp=esperando().filter(function(x){return!marcas[x.id]}),prod=D.grupos.producao&&D.grupos.producao.dados,prox=null;
  if(prod)prox=(prod.timers||[]).filter(function(t){return t.proxima&&/diario|publicar|dia$/.test(t.unidade)}).sort(function(a,b){return a.proxima-b.proxima})[0];
  return saudacao()+', '+NOME+'. '+c.ok+' de '+c.total+' sistemas em ordem'+(c.erros?', '+plural(c.erros,'erro','erros'):'')+(c.avisos?', '+plural(c.avisos,'aviso','avisos'):'')+'. '
    +plural(c.publicados,'vídeo publicado','vídeos publicados')+' hoje. '+(prox?'Próxima rodada: '+prox.unidade.replace(/-/g,' ')+' às '+hm(prox.proxima)+'. ':'')
    +(esp.length?'A primeira coisa a ver: '+esp[0].texto+'.':'Nada esperando você.')}
var CMDS={
  bomdia:function(){falar(textoBomDia(),'bom dia')},
  status:function(){var s=sistemas().map(function(x){return NOMES[x.nome]+': '+x.frase}).slice(0,5).join('. ');falar('Status. '+s+'. Leitura '+ha(D.gerado_em)+'.','status')},
  espera:function(){var ab=esperando().filter(function(x){return!marcas[x.id]});if(!ab.length)return falar('Nada esperando você. Tudo marcado.','livre');
    falar(plural(ab.length,'coisa esperando','coisas esperando')+' você. '+ab.slice(0,3).map(function(x,i){return(i+1)+': '+x.texto}).join('. ')+'.','esperando você')},
  foco:function(){var on=document.body.classList.toggle('foco');$('bFoco').classList.toggle('on',on);$('bFoco').setAttribute('aria-pressed',String(on));falar(on?'Modo foco ligado. Escondi os painéis.':'Modo foco desligado.',on?'modo foco':'')}
};
document.querySelectorAll('.barra button').forEach(function(b){b.addEventListener('click',function(){if(D)CMDS[b.dataset.cmd]()})});
addEventListener('keydown',function(ev){if(ev.target.closest&&ev.target.closest('input,textarea'))return;var k={'1':'bomdia','2':'status','3':'espera','4':'foco'}[ev.key];if(k&&D)CMDS[k]()});
function pintarVoz(){$('voz').textContent='Voz: '+(vozLigada?'ligada':'desligada');$('voz').classList.toggle('desl',!vozLigada);$('voz').setAttribute('aria-pressed',String(vozLigada))}
$('voz').addEventListener('click',function(){vozLigada=!vozLigada;pintarVoz();LS.set('jarvis.voz',vozLigada?'1':'0');if(!vozLigada&&window.speechSynthesis)speechSynthesis.cancel()});
if(!window.speechSynthesis){vozLigada=false;$('voz').disabled=true}
pintarVoz();
// Alertas novos (depois da primeira leitura) viram fala, uma vez cada.
function vozNovos(al){var novos=al.filter(function(a){return!falados[a.chave]});novos.forEach(function(a){falados[a.chave]=1});if(novos.length&&partiu)falar('Atenção. '+novos.slice(0,3).map(function(a){return a.texto}).join('. ')+'.','alerta novo')}
// ---------- dados ----------
async function ler(){try{var r=await fetch('/api/painel',{cache:'no-store',credentials:'same-origin'});
  if(r.status===401){location.href='/login';return}
  if(!r.ok)throw new Error('HTTP '+r.status);D=await r.json();
  if(primeira){(D.alertas||[]).forEach(function(a){falados[a.chave]=1});primeira=false}else vozNovos(D.alertas||[]);
  desenhar()}catch(e){$('ver').textContent='sem conexão com o bot ('+e.message+') — tento de novo em 15 s'}}
// ---------- relógio ----------
function relogio(){var d=new Date();$('relogio').textContent=d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});$('data').textContent=d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'})}
relogio();setInterval(relogio,1000);
// ---------- núcleo (canvas) ----------
var cv=$('cv'),cx=cv.getContext&&cv.getContext('2d');
function ajustar(){var r=cv.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);cv.width=Math.max(200,r.width*dpr);cv.height=Math.max(200,r.height*dpr)}
addEventListener('resize',ajustar);ajustar();
var ANEIS=[{r:.84,v:.18,seg:64,w:2,gap:.35},{r:.74,v:-.42,seg:6,w:6,gap:.5},{r:.64,v:.9,seg:24,w:3,gap:.3}];
var t0=performance.now(),visivel=true;
document.addEventListener('visibilitychange',function(){visivel=!document.hidden;if(visivel)requestAnimationFrame(quadro)});
function quadro(agora){if(!visivel||!cx)return;var t=(agora-t0)/1000,W=cv.width,H=cv.height,R=Math.min(W,H)/2,X=W/2,Y=H/2,k=W/520;
  var erro=D&&(D.alertas||[]).some(function(a){return a.nivel==='erro'}),cor=erro?'255,93,108':'95,227,255';
  cx.clearRect(0,0,W,H);var pulso=REDUZ?.7:.55+.45*(.5+.5*Math.sin(t*2.1));
  var g=cx.createRadialGradient(X,Y,0,X,Y,R*.62);g.addColorStop(0,'rgba(160,240,255,'+(.30*pulso)+')');g.addColorStop(.6,'rgba('+cor+','+(.12*pulso)+')');g.addColorStop(1,'rgba(0,0,0,0)');
  cx.fillStyle=g;cx.beginPath();cx.arc(X,Y,R*.62,0,7);cx.fill();
  ANEIS.forEach(function(a,i){var rot=REDUZ?i:t*a.v,rr=R*a.r,passo=Math.PI*2/a.seg;cx.beginPath();
    for(var s=0;s<a.seg;s++){var ini=rot+s*passo;cx.moveTo(X+Math.cos(ini)*rr,Y+Math.sin(ini)*rr);cx.arc(X,Y,rr,ini,ini+passo*(1-a.gap))}
    cx.lineWidth=a.w*3.5*k;cx.strokeStyle='rgba('+cor+','+(.10+.10*pulso)+')';cx.stroke();
    cx.lineWidth=a.w*k;cx.strokeStyle=i===1?'rgba(232,247,255,.9)':'rgba('+cor+','+(.6+.35*pulso)+')';cx.stroke()});
  cx.strokeStyle='rgba('+cor+',.25)';cx.lineWidth=k;cx.beginPath();
  for(var s=0;s<120;s++){var an=s*Math.PI/60-(REDUZ?0:t*.05),r1=R*.9,r2=R*(s%10?.92:.95);cx.moveTo(X+Math.cos(an)*r1,Y+Math.sin(an)*r1);cx.lineTo(X+Math.cos(an)*r2,Y+Math.sin(an)*r2)}
  cx.stroke();
  if(falando||agora<ondaAte){for(var q=0;q<2;q++){cx.beginPath();for(var p=0;p<=180;p++){var b=p/180*Math.PI*2,amp=R*.035*(Math.sin(b*6+t*9+q*2)*.6+Math.sin(b*11-t*13)*.4)*(.6+.4*Math.sin(t*7+q)),r=R*(.55+q*.035)+amp,x=X+Math.cos(b)*r,y=Y+Math.sin(b)*r;if(p)cx.lineTo(x,y);else cx.moveTo(x,y)}
    cx.strokeStyle=q?'rgba(232,247,255,.45)':'rgba('+cor+',.85)';cx.lineWidth=2*k;cx.stroke()}}
  requestAnimationFrame(quadro)}
requestAnimationFrame(quadro);
// ---------- partida (~3 s) ----------
function espera(ms){return new Promise(function(r){setTimeout(r,ms)})}
async function partida(){await ler();var c=D?contagem():null;
  var linhas=['> Inicializando…','> Sistemas no ar. ('+(c?c.ok+' de '+c.total+' em ordem':'sem leitura')+')','> '+saudacao()+', '+NOME+'.'],pre=$('partidaTxt');
  if(REDUZ){pre.textContent=linhas.join('\n');await espera(800)}
  else for(var i=0;i<linhas.length;i++){for(var j=0;j<=linhas[i].length;j++){pre.textContent=linhas.slice(0,i).join('\n')+(i?'\n':'')+linhas[i].slice(0,j);await espera(22)}await espera(380)}
  $('partida').classList.add('fim');document.body.classList.remove('partindo');partiu=true;
  if(D)falar(saudacao()+', '+NOME+'. '+(c.erros?plural(c.erros,'erro pedindo','erros pedindo')+' atenção.':'Sistemas no ar.'),'online');
  setInterval(ler,15000)}
partida();
})();`;

export const JARVIS_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>JARVIS — Painel INEMA</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<style>${JARVIS_CSS}</style></head>
<body class="partindo">
<div id="partida" aria-hidden="true"><pre id="partidaTxt"></pre></div>
<div class="app">
  <header>
    <span class="marca">JARVIS · INEMA</span>
    <span class="ver" id="ver">carregando…</span>
    <span class="data" id="data"></span>
    <span class="relogio" id="relogio">--:--</span>
    <button class="selo" id="voz" type="button" aria-pressed="true">Voz: ligada</button>
    <a class="selo" href="/painel" title="Voltar ao painel com os cartões">Painel clássico</a>
    <span id="sair" hidden><form class="in" method="post" action="/logout"><button class="selo" type="submit">Sair</button></form></span>
  </header>
  <main>
    <section class="painel" aria-labelledby="hSis">
      <h2 id="hSis">Sistemas</h2>
      <p class="sub" id="subSis">lendo…</p>
      <div class="rolar">
        <ul class="lista" id="listaSis"></ul>
        <h3>Próximos timers</h3><ul class="lista" id="listaTim"></ul>
        <h3>Últimos publicados</h3><ul class="lista" id="listaPub"></ul>
      </div>
    </section>
    <section class="nucleo" aria-label="Núcleo do Jarvis">
      <canvas id="cv" width="520" height="520" aria-hidden="true"></canvas>
      <div class="centro"><div class="nomeia">JARVIS</div><div class="status" id="status">inicializando</div></div>
      <div class="contas" id="contas"></div>
    </section>
    <section class="painel" aria-labelledby="hEsp">
      <h2 id="hEsp">Esperando você</h2>
      <p class="sub" id="subEsp">lendo…</p>
      <div class="rolar"><ul class="lista esp" id="listaEsp"></ul></div>
      <p class="aviso-rod">Visto e Depois só marcam nesta tela (ficam neste navegador). Nada é executado.</p>
    </section>
  </main>
  <footer>
    <div class="resposta" id="resposta" aria-live="polite"></div>
    <div class="barra" role="toolbar" aria-label="Atalhos">
      <span class="pr">&gt;_</span>
      <button type="button" data-cmd="bomdia">Bom dia<kbd>1</kbd></button>
      <button type="button" data-cmd="status">Status<kbd>2</kbd></button>
      <button type="button" data-cmd="espera">O que espera<kbd>3</kbd></button>
      <button type="button" data-cmd="foco" id="bFoco" aria-pressed="false">Modo foco<kbd>4</kbd></button>
    </div>
  </footer>
</div>
<script>${JARVIS_JS}</script>
</body></html>`;
