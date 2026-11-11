// JS do cliente, parte 2: como cada grupo aparece no cartão (tile) e no
// detalhe. Modo lista / ícones / imagens vale para Produção, Publicação e Terminais.
export const JS_GRUPOS = String.raw`
var G={};
G.maquina={tile:function(d){var m=d.memoria,k=d.disco,c=d.carga,gp=d.gpu_oom,h='';
  var fr=m?'<p class="frase">'+n(m.disponivel_gb)+' GB livres de '+n(m.total_gb,0)+'</p>':'<p class="frase vazia">sem leitura de memória</p>';
  if(m)h+='<div class="linha"><span class="k">Memória em uso</span>'+barra(100*(1-m.disponivel_gb/m.total_gb),95)+'<span class="v">'+Math.round(100*(1-m.disponivel_gb/m.total_gb))+'%</span></div>';
  if(m&&m.cache_gb!=null&&m.cache_gb>=16)h+=linha('Cache de disco',n(m.cache_gb)+' GB','s-aviso');
  if(k)h+='<div class="linha"><span class="k">Disco</span>'+barra(k.usado_pct,90)+'<span class="v">'+k.usado_pct+'% · '+k.livre_gb+' GB livres</span></div>';
  if(c)h+=linha('Carga',n(c.m1,2)+' em '+c.nucleos+' núcleos');
  h+=linha('Ligada',d.boot_em?ha(d.boot_em):'–');
  h+=linha('Falhas de memória da GPU (24 h)',gp.erro?esc(gp.erro):gp.ultimas_24h?(gp.ultimas_24h+' em 24 h, última '+hm(gp.ultima_em)):'nenhum em 24 h',gp.ultima_hora?'s-erro':gp.ultimas_24h?'s-aviso':'');
  return{frase:fr,corpo:h}},
 detalhe:function(d){var m=d.memoria||{},k=d.disco||{},c=d.carga||{},gp=d.gpu_oom;
  return sec('Agora',tabela(['Medida','Valor'],[['Memória disponível',n(m.disponivel_gb)+' GB de '+n(m.total_gb,0)+' GB'],['Cache de disco',(m.cache_gb!=null?n(m.cache_gb)+' GB (conta como disponível, mas a GPU usa a mesma RAM e pode falhar com cache alto)':'–')],['Swap em uso',n(m.swap_usado_gb)+' GB'],['Disco da raiz',(k.usado_pct??'–')+'% usado, '+(k.livre_gb??'–')+' GB livres de '+(k.total_gb??'–')],['Carga 1/5/15 min',n(c.m1,2)+' / '+n(c.m5,2)+' / '+n(c.m15,2)+' ('+(c.nucleos||'–')+' núcleos)'],['Ligada desde',quando(d.boot_em)+' ('+ha(d.boot_em)+')']]))
  +sec('Reinícios recentes',d.reinicios.erro?'<p class="sem">'+esc(d.reinicios.erro)+'</p>':tabela(['Início do boot'],d.reinicios.em.slice().reverse().map(function(t){return[quando(t)+' <span class="mut">('+ha(t)+')</span>']})))
  +sec('Falhas de memória da GPU (kernel, 24 h)',gp.erro?'<p class="sem">'+esc(gp.erro)+'</p>':tabela(['Últimas 24 h','Última hora','Último'],[[gp.ultimas_24h,gp.ultima_hora,quando(gp.ultima_em)]]))}};

function falhasDe(d){var v=(d.v3&&d.v3.falhas_24h||[]).map(function(f){f.bot='v3';return f}),a=(d.inemaccbot&&d.inemaccbot.falhas_24h||[]).map(function(f){f.bot='inemaccbot';return f});return v.concat(a).sort(function(x,y){return(y.quando||0)-(x.quando||0)})}
G.bots={tile:function(d){var fl=falhasDe(d),v=d.v3,a=d.inemaccbot,rod=(v?v.jobs.rodando:0)+(a?a.jobs.rodando:0),fi=(v?v.jobs.na_fila:0)+(a?a.jobs.na_fila:0);
  var fr=fl.length?'<p class="frase s-erro">'+plural(fl.length,'falha','falhas')+' em 24 h</p>':'<p class="frase">'+rod+' rodando, '+fi+' na fila</p>';
  var h=Object.keys(d.servicos).map(function(s){var st=d.servicos[s],ok=st==='active';return linha(esc(s),(ok?'✓ ativo':st==='desconhecido'?'– desconhecido':'✕ '+esc(st)),ok?'s-ok':st==='desconhecido'?'fraco':'s-erro')}).join('');
  if(v)h+=linha('v3 hoje',v.jobs.criados_hoje+' jobs, '+usd(v.custo_hoje.usd));
  if(a)h+=linha('inemaccbot',plural(a.fluxos_abertos.length,'fluxo aberto','fluxos abertos')+(a.aguardando_ok.length?', '+a.aguardando_ok.length+' aguardando OK':''),a.aguardando_ok.length?'s-aviso':'');
  if(fl[0])h+=linhaTx(simb('erro')+' '+esc(fl[0].bot+' #'+fl[0].id+' '+fl[0].tarefa),hm(fl[0].quando));
  return{frase:fr,corpo:h}},
 detalhe:function(d){var v=d.v3,a=d.inemaccbot,fl=falhasDe(d);
  var hf=fl.length?fl.map(function(f){return'<div class="sec"><div class="linha"><span class="tx">'+simb('erro')+' <b>'+esc(f.bot)+' #'+f.id+'</b> '+esc(f.fila+'/'+f.tarefa)+'</span><span class="v mut">'+quando(f.quando)+'</span></div><div class="mut">'+esc(f.erro)+'</div><button class="link" data-falha="'+esc(f.bot)+':'+f.id+'">ver resultado completo</button><pre id="falha-'+esc(f.bot)+'-'+f.id+'" style="display:none"></pre></div>'}).join(''):'<p class="sem">nenhuma falha nas últimas 24 h</p>';
  return sec('Serviços',tabela(['Serviço','Estado'],Object.keys(d.servicos).map(function(s){var st=d.servicos[s];return[esc(s),st==='active'?'<span class="s-ok">✓ ativo</span>':'<span class="s-erro">✕ '+esc(st)+'</span>']})))
  +(v?sec('openpcbotv3',tabela(['Medida','Valor'],[['Rodando / na fila',v.jobs.rodando+' / '+v.jobs.na_fila],['Jobs criados hoje',v.jobs.criados_hoje],['Sessões usadas na última hora',v.sessoes_1h],['Custo do dia',usd(v.custo_hoje.usd)+' em '+v.custo_hoje.chamadas+' chamadas'],['Por estado (jobs recentes)',Object.keys(v.jobs.por_estado_recente).map(function(k){return esc(k)+' '+v.jobs.por_estado_recente[k]}).join(', ')]])+'<h3 style="margin-top:.8rem">Próximos crons</h3>'+tabela(['Nome','Quando'],v.cron.map(function(c){return[esc(c.nome),quando(c.proxima_em)]}))):'')
  +(a?sec('inemaccbot',tabela(['Medida','Valor'],[['Rodando / na fila',a.jobs.rodando+' / '+a.jobs.na_fila]])+'<h3 style="margin-top:.8rem">Fluxos abertos</h3>'+tabela(['#','Tipo','Assunto','Estado'],a.fluxos_abertos.map(function(f){return[f.id,esc(f.tipo),esc(f.slug),esc(f.status)]}))+'<h3 style="margin-top:.8rem">Aguardando seu OK</h3>'+tabela(['Fluxo','Fase'],a.aguardando_ok.map(function(x){return['#'+x.fluxo_id+' '+esc(x.slug),esc(x.fase)]}))):'')
  +sec('Falhas das últimas 24 h',hf,1)}};

function rodadaEstado(r){if(r.presa)return['erro','parada há '+dur(r.aberta_min*60)];if(r.fim==null)return['aviso','rodando há '+dur((r.aberta_min||0)*60)];if(r.resultado==='falhou')return['erro','falhou'];return['ok',r.resultado.replace('_',' ')+(r.dur_s!=null?', '+dur(r.dur_s):'')]}
// Uma linha por unidade no cartão (Nei, 11/11: "radar viral 1x"): fica a mais recente, com ×N.
function umaVez(l){var vistos={},out=[];l.forEach(function(r){var u=r.unidade;if(vistos[u]){vistos[u]._n=(vistos[u]._n||1)+1;return}var c={};for(var k in r)c[k]=r[k];vistos[u]=c;out.push(c)});return out}
function modoRodadas(lista,max,horiz){var l=lista.slice(0,max);if(!l.length)return'<p class="sem">nenhuma rodada registrada hoje</p>';
  if(E.modo==='icones')return'<div class="icones">'+l.map(function(r){var e=rodadaEstado(r);return ico(inicial(r.unidade),r.unidade,cor(r.unidade),e[0]==='erro',r.unidade+': '+e[1])}).join('')+'</div>';
  if(E.modo==='imagens')return'<div class="cartoes'+(horiz?' horiz':'')+'">'+l.map(function(r){var e=rodadaEstado(r);return cartao(null,inicial(r.unidade),cor(r.unidade),r.unidade,(e[0]==='erro'?'✕ ':e[0]==='ok'?'✓ ':'… ')+e[1]+' · '+hm(r.inicio||r.fim),e[0]==='erro')}).join('')+'</div>';
  return l.map(function(r){var e=rodadaEstado(r);return linhaTx(simb(e[0])+' '+esc(r.unidade)+(r._n>1?' <span class="fraco">×'+r._n+'</span>':'')+' <span class="fraco">'+hm(r.inicio||r.fim)+'</span>',esc(e[1]),'s-'+e[0])}).join('')}
G.producao={tile:function(d,g){var h=d.hoje,feitas=h.filter(function(r){return r.fim!=null}).length,sem=g.ausentes&&g.ausentes.indexOf('rodadas.jsonl')>=0;
  var fr=d.presas.length?'<p class="frase s-erro">'+plural(d.presas.length,'rodada parada','rodadas paradas')+'</p>':sem?'<p class="frase vazia">placar de rodadas ainda não existe</p>':h.length?'<p class="frase">'+feitas+' de '+h.length+' rodadas fechadas</p>':'<p class="frase vazia">nenhuma rodada hoje</p>';
  var mx=E.modo==='lista'?4:E.modo==='icones'?8:2;
  var c=modoRodadas(d.presas.concat(umaVez(h.filter(function(r){return!r.presa}))),mx,true);
  var ab=d.esperas.filter(function(e){return e.estado==='esperando'||e.estado==='rodando'}).length;
  c+=linha('Esperas do continua',ab?ab+' abertas':'nenhuma aberta');
  if(d.timers[0]&&E.modo!=='imagens')c+=linha('Próximo timer',esc(d.timers[0].unidade)+' às '+hm(d.timers[0].proxima));
  return{frase:fr,corpo:c+mais(h.length,mx)}},
 detalhe:function(d){var todas=d.presas.concat(d.hoje.filter(function(r){return!r.presa}));
  var lst=E.modo==='lista'?tabela(['Unidade','Edição','Início','Fim','Resultado'],todas.map(function(r){var e=rodadaEstado(r);return[esc(r.unidade),esc(r.edicao||''),hm(r.inicio),hm(r.fim),'<span class="s-'+e[0]+'">'+simb(e[0])+' '+esc(e[1])+'</span>'+(r.motivo?'<div class="mut">'+esc(r.motivo)+'</div>':'')]})):modoRodadas(todas,200);
  return sec('Rodadas de hoje',lst,1)
  +sec('Esperas do continua',tabela(['Chave','Estado','Desde','Teto'],d.esperas.map(function(e){return[esc(e.chave),(e.passou_teto?'<span class="s-aviso">! passou do teto</span>':esc(e.estado)),quando(e.desde),e.teto_h!=null?e.teto_h+' h':'–']})))
  +sec('Próximos timers',tabela(['Timer','Próxima','Última'],d.timers.map(function(t){return[esc(t.unidade),quando(t.proxima),quando(t.ultima)]})))}};

function modoUploads(l,max,horiz){l=l.slice(0,max);if(!l.length)return'<p class="sem">nenhum envio registrado</p>';
  if(E.modo==='imagens')return'<div class="cartoes'+(horiz?' horiz':'')+'">'+l.map(function(u){return cartao(okId(u.video_id)?u.miniatura:null,inicial(u.canal),cor(u.canal),u.titulo,u.canal+' · '+quando(u.quando))}).join('')+'</div>';
  return l.map(function(u){return linhaTx('<span class="fraco">'+hm(u.quando)+'</span> '+esc(u.titulo),esc(u.canal),'mut')}).join('')}
var EST_ROT={pendente:'na fila',publicando:'publicando',feito:'feito',erro:'erro',retirado:'retirado'},EST_SIMB={pendente:'aviso',publicando:'ok',feito:'ok',erro:'erro',retirado:''};
function totFilas(fi){var t={pendente:0,publicando:0,erro:0};(fi||[]).forEach(function(f){t.pendente+=f.por_estado.pendente;t.publicando+=f.por_estado.publicando;t.erro+=f.por_estado.erro});return t}
function resumoFilas(fs,curto,fi){if(fi){var t=totFilas(fi),pr=fi.filter(function(f){return f.problema&&/VAZIO|corrompido/.test(f.problema)});
    return linha('Filas',(t.publicando?t.publicando+' publicando · ':'')+t.pendente+' na fila'+(t.erro?' · <span class="s-erro">'+t.erro+' com erro</span>':'')+(pr.length?' · <span class="s-erro">'+esc(pr[0].nome)+' ilegível</span>':''))}
  if(curto){var u=fs.filter(function(f){return f.por_estado.pendente||f.erros_recentes.length}).map(function(f){return esc(f.nome)+' '+(f.por_estado.pendente||0)+(f.erros_recentes.length?' <span class="s-aviso">! erro</span>':'')});return linha('Filas pendentes',u.length?u.join(', '):'nada pendente')}
  return fs.map(function(f){var p=f.por_estado,er=f.erros_recentes.length;return linha('Fila '+esc(f.nome),(p.pendente?p.pendente+' pendentes':'nada pendente')+(er?', <span class="s-aviso">'+er+' com erro recente</span>':''))}).join('')}
function filaSec(f){var p=f.por_estado,ch=['publicando','pendente','erro','retirado','feito'].filter(function(k){return p[k]}).map(function(k){return'<span class="chip '+(k==='erro'?'s-erro':k==='pendente'?'s-aviso':'')+'">'+p[k]+' '+EST_ROT[k]+'</span>'}).join(' ');
  var cab='<div class="filacab">'+(ch||'<span class="fraco">vazia</span>')+(f.problema?' <span class="s-erro">'+simb('erro')+' '+esc(f.problema)+'</span>':'')+'</div><div class="fraco filaonde">'+esc(f.quem)+' · <code>'+esc(pastaCurta(f.onde))+'</code>'+(p.feito>5?' · mostrando os 5 feitos mais recentes':'')+'</div>';
  return sec(esc(f.nome)+' <span class="fraco">('+f.total+')</span>',cab+(f.itens.length?tabela(['Estado','Item','Canal','Quando','Tent.','Erro'],f.itens.map(function(i){return[simb(EST_SIMB[i.estado])+' '+EST_ROT[i.estado]+(i.original&&i.original!==i.estado&&EST_ROT[i.estado]!==i.original?' <span class="fraco">('+esc(i.original)+')</span>':''),esc(i.nome)+(i.arquivo&&i.arquivo!==i.nome?'<br><span class="fraco">'+esc(i.arquivo)+'</span>':''),esc(i.canal||'–'),quando(i.quando),i.tentativas==null?'–':i.tentativas,i.erro?'<span class="mut">'+esc(i.erro)+'</span>':''] })):''),1)}
G.radar={tile:function(d){var fi=d.fila||[],lib=fi.filter(function(i){return i.estado==='liberado'});
  var fr='<p class="frase'+(d.erros_24h?' s-erro':'')+'">'+plural(d.hoje||0,'publicado hoje','publicados hoje')+' · '+fi.length+' na fila'+(d.erros_24h?' · '+plural(d.erros_24h,'erro','erros')+' em 24 h':'')+'</p>';
  var EST={publicado:['ok','publicado'],na_fila:['aviso','na fila'],erro:['erro','erro'],nada:['','ainda não']};
  var c=(d.nichos||[]).map(function(x){var e=EST[x.hoje]||EST.nada;return linhaTx(simb(e[0])+' <b>'+esc(x.nome)+'</b> <span class="fraco">gera '+esc(x.gera)+' · sai ≥ '+esc(x.a_partir)+'</span>',e[1]+(x.quando&&x.hoje==='publicado'?' '+hm(x.quando):''),e[0]==='erro'?'s-erro':'mut')}).join('');
  c+=linha('Próxima rodada',hm(d.proxima)+(lib.length?' · sai '+esc(lib[0].nome):' · nada liberado'));
  return{frase:fr,corpo:c}},
 detalhe:function(d){var EST={publicado:'✓ publicado',na_fila:'! na fila',erro:'✕ erro',nada:'ainda não'},FE={liberado:'liberado (sai na próxima hora livre)',espera:'espera o horário',segurado:'SEGURADO (rm SEGURAR para liberar)'};
  return sec('Nichos e horários — canal '+esc(d.canal)+' (1 vídeo por hora)',tabela(['Nicho','Projeto','Gera às','Publica a partir de','Hoje'],(d.nichos||[]).map(function(x){return[esc(x.nome),esc(x.projeto),esc(x.gera),esc(x.a_partir),EST[x.hoje]+(x.url?' · <a href="'+esc(x.url)+'" target="_blank" rel="noopener">vídeo</a>':'')]})),1)
  +sec('Fila (sai o mais antigo liberado, 1 por hora)',tabela(['Nicho','Edição','Pronto desde','Estado'],(d.fila||[]).map(function(i){return[esc(i.nome),esc(i.edicao)+(i.video!=='video'?' <span class="fraco">'+esc(i.video)+'</span>':''),quando(i.desde),FE[i.estado]+(i.estado==='espera'?' ('+esc(i.a_partir)+')':'')]})))
  +sec('Últimos envios',tabela(['Quando','Nicho','Resultado'],(d.historico||[]).map(function(h){return[quando(h.quando),esc(h.nome)+' <span class="fraco">'+esc(h.edicao)+'</span>',(h.url?'<a href="'+esc(h.url)+'" target="_blank" rel="noopener">'+esc(h.resultado)+'</a>':esc(h.resultado))+(h.motivo?' <span class="mut">'+esc(h.motivo)+'</span>':'')]})))}};

G.publicacao={tile:function(d){var fr='<p class="frase">'+plural(d.hoje,'vídeo publicado hoje','vídeos publicados hoje')+'</p>',c;
  if(E.modo==='icones'){var cs=Object.keys(d.semana_por_canal).slice(0,4);c=cs.length?'<div class="icones">'+cs.map(function(k){return ico(String(d.semana_por_canal[k]),k,cor(k),false,k+': '+d.semana_por_canal[k]+' em 7 dias')}).join('')+'</div><div class="fraco" style="font-size:.85rem">envios por canal, últimos 7 dias</div>':'<p class="sem">nenhum envio em 7 dias</p>'}
  else c=modoUploads(d.ultimos,E.modo==='imagens'?2:3,true);
  return{frase:fr,corpo:c+resumoFilas(d.filas,E.modo!=='lista',d.filas_itens)}},
 detalhe:function(d){var cs=Object.keys(d.semana_por_canal);
  return(d.filas_itens?'<h2 class="subt">Filas — o que tem em cada uma e o estado</h2>'+d.filas_itens.map(filaSec).join(''):'')+sec('Últimos envios',E.modo==='lista'?tabela(['Quando','Canal','Título'],d.ultimos.map(function(u){return[quando(u.quando),esc(u.canal),u.url?'<a href="'+esc(u.url)+'" target="_blank" rel="noopener">'+esc(u.titulo)+'</a>':esc(u.titulo)]})):modoUploads(d.ultimos,10),1)
  +sec('Por canal',tabela(['Canal','Hoje','7 dias'],cs.map(function(k){return[esc(k),d.hoje_por_canal[k]||0,d.semana_por_canal[k]]})))
  +(d.filas_itens?'':sec('Filas de publicação',tabela(['Fila','Total','Por estado'],d.filas.map(function(f){return[esc(f.nome),f.total,Object.keys(f.por_estado).map(function(k){return esc(k)+' '+f.por_estado[k]}).join(', ')]}))+d.filas.map(function(f){return f.erros_recentes.length?'<h3 style="margin-top:.8rem">Erros recentes na fila '+esc(f.nome)+'</h3>'+tabela(['Item','Erro'],f.erros_recentes.map(function(e){return[esc(e.nome),esc(e.erro)]})):''}).join('')))}};

// Um quadro por bot (Nei, 11/11/2026: "card do inemaccbot e do v2 e v3"). O detalhe reaproveita o do grupo bots.
function svcLinha(st){var ok=st==='active';return linha('Serviço',ok?'✓ ativo':st==='desconhecido'?'– desconhecido':'✕ '+esc(st),ok?'s-ok':st==='desconhecido'?'fraco':'s-erro')}
function botFalhas(b,nome){return((b&&b.falhas_24h)||[]).map(function(f){f.bot=nome;return f})}
G.v3={tile:function(d){var b=d.bot,fl=botFalhas(b,'v3');
  var fr=d.servico!=='active'?'<p class="frase s-erro">serviço '+esc(d.servico)+'</p>':!b?'<p class="frase vazia">sem leitura do banco</p>':fl.length?'<p class="frase s-erro">'+plural(fl.length,'falha','falhas')+' em 24 h</p>':'<p class="frase">'+b.jobs.rodando+' rodando, '+b.jobs.na_fila+' na fila</p>';
  var h=svcLinha(d.servico);if(b){h+=linha('Jobs hoje',b.jobs.criados_hoje+' · '+usd(b.custo_hoje.usd));h+=linha('Sessões na última hora',b.sessoes_1h);if(b.cron&&b.cron[0])h+=linha('Próxima rotina',esc(b.cron[0].nome)+' às '+hm(b.cron[0].proxima_em))}
  if(fl[0])h+=linhaTx(simb('erro')+' #'+fl[0].id+' '+esc(fl[0].tarefa),hm(fl[0].quando));return{frase:fr,corpo:h}},
 detalhe:function(d){return G.bots.detalhe({v3:d.bot,inemaccbot:null,servicos:{openpcbotv3:d.servico}})}};
G.inemaccbot={tile:function(d){var b=d.bot,fl=botFalhas(b,'inemaccbot');
  var fr=d.servico!=='active'?'<p class="frase s-erro">serviço '+esc(d.servico)+'</p>':!b?'<p class="frase vazia">sem leitura do banco</p>':fl.length?'<p class="frase s-erro">'+plural(fl.length,'falha','falhas')+' em 24 h</p>':b.aguardando_ok.length?'<p class="frase s-aviso">'+plural(b.aguardando_ok.length,'fluxo esperando seu OK','fluxos esperando seu OK')+'</p>':'<p class="frase">'+plural(b.fluxos_abertos.length,'fluxo aberto','fluxos abertos')+'</p>';
  var h=svcLinha(d.servico);if(b){h+=linha('Rodando / na fila',b.jobs.rodando+' / '+b.jobs.na_fila);b.fluxos_abertos.slice(0,3).forEach(function(f){h+=linhaTx(esc(f.tipo)+' · '+esc(f.slug),esc(f.status),'mut')})}
  if(fl[0])h+=linhaTx(simb('erro')+' #'+fl[0].id+' '+esc(fl[0].tarefa),hm(fl[0].quando));return{frase:fr,corpo:h}},
 detalhe:function(d){return G.bots.detalhe({v3:null,inemaccbot:d.bot,servicos:{inemaccbot:d.servico}})}};
G.v2={tile:function(d){var b=d.bot;
  var fr=d.servico!=='active'?'<p class="frase s-erro">serviço '+esc(d.servico)+'</p>':!b?'<p class="frase vazia">sem leitura do banco</p>':'<p class="frase">'+(b.msgs_24h?plural(b.msgs_24h,'mensagem','mensagens')+' em 24 h':'parado: última conversa '+(b.ultima_msg?'há '+dur(Date.now()/1000-b.ultima_msg):'–'))+'</p>';
  var h=svcLinha(d.servico);if(b){h+=linha('Mensagens em 7 dias',b.msgs_7d);h+=linha('Custo em 7 dias',usd(b.custo_7d_usd));if(b.ultimo_video)h+=linha('Último vídeo','#'+b.ultimo_video.id+' '+esc(b.ultimo_video.skill)+' · '+esc(b.ultimo_video.status),b.ultimo_video.status==='failed'?'s-erro':'')}
  return{frase:fr,corpo:h}},
 detalhe:function(d){var b=d.bot||{};return sec('Bot v2 (openpcbotv2)',tabela(['Medida','Valor'],[['Serviço',d.servico==='active'?'<span class="s-ok">✓ ativo</span>':'<span class="s-erro">✕ '+esc(d.servico)+'</span>'],['Última conversa',b.ultima_msg?quando(b.ultima_msg):'–'],['Mensagens 24 h / 7 dias',(b.msgs_24h||0)+' / '+(b.msgs_7d||0)],['Custo em 7 dias',usd(b.custo_7d_usd)],['Tarefas agendadas ativas',b.tarefas_agendadas!=null?b.tarefas_agendadas:'–'],['Vídeos por estado',Object.keys(b.videos||{}).map(function(k){return esc(k)+' '+b.videos[k]}).join(' · ')||'–'],['Último vídeo',b.ultimo_video?'#'+b.ultimo_video.id+' '+esc(b.ultimo_video.skill)+' · '+esc(b.ultimo_video.status)+' · '+quando(b.ultimo_video.quando)+(b.ultimo_video.erro?'<div class="mut">'+esc(b.ultimo_video.erro)+'</div>':''):'–']]))+'<p class="nota">Lido do banco do v2 (store/openpcbot.db) só para consulta.</p>'}};

G.creditos={tile:function(d){var l=d.claude.limites,sem7=l.filter(function(x){return/todos/.test(x.nome)})[0]||l[0];
  var fr=(sem7||d.codex)?'<p class="frase">Claude '+(sem7?sem7.pct+'%':'–')+' · Codex '+(d.codex?d.codex.pct+'%':'–')+'</p>':'<p class="frase vazia">sem leitura dos limites</p>';
  var h=l.map(function(x){return'<div class="linha"><span class="k">'+esc(x.nome)+'</span>'+barra(x.pct,80)+'<span class="v">'+x.pct+'%</span></div>'}).join('');
  if(d.codex)h+='<div class="linha"><span class="k">Codex</span>'+barra(d.codex.pct,80)+'<span class="v">'+d.codex.pct+'%</span></div>';
  if(d.claude.idade_s!=null)h+=linha('Medida do Claude','há '+dur(d.claude.idade_s),d.claude.idade_s>6*3600?'s-aviso':'');
  if(d.codex&&d.codex.reset_em)h+=linha('Codex volta a zero',quando(d.codex.reset_em));
  var r7=l.filter(function(x){return/todos/.test(x.nome)})[0];if(r7&&r7.reset_em)h+=linha('Claude volta a zero',quando(r7.reset_em));
  return{frase:fr,corpo:h}},
 detalhe:function(d){return sec('Claude',tabela(['Limite','Usado','Volta a zero'],d.claude.limites.map(function(x){return[esc(x.nome),x.pct+'%',quando(x.reset_em)]}))+'<p class="nota">Medida gravada pela statusline '+(d.claude.idade_s!=null?'há '+dur(d.claude.idade_s):'(sem arquivo)')+'.</p>')
  +sec('Codex',d.codex?tabela(['Medida','Valor'],[['Usado',d.codex.pct+'%'+(d.codex.janela_h?' da janela de '+d.codex.janela_h+' h':'')],['Volta a zero',quando(d.codex.reset_em)],['Plano',esc(d.codex.plano||'–')],['Registro lido','há '+dur(d.codex.idade_s)]]):'<p class="sem">sem dados</p>')
  +'<p class="nota">Uso pela assinatura (nunca API). O uso por provedor e os avisos de login estão no quadro Outras APIs.</p>'}};

// VPS (10/11/2026): as 6 máquinas, disco/memória/carga por SSH só leitura (fontes/vps.ts).
function vpsNome(x){return x.id.toUpperCase()+' '+x.nome}
G.vps={tile:function(d){var v=d.vps||[],ok=v.filter(function(x){return x.medida&&x.medida.ok}).length,med=v.some(function(x){return x.medida});
  var fr=!v.length?'<p class="frase vazia">sem inventário</p>':!med?'<p class="frase vazia">medindo…</p>':'<p class="frase">'+ok+' de '+v.length+' respondendo</p>';
  var h=v.map(function(x){var m=x.medida;if(!m)return linha(esc(x.id.toUpperCase()),'medindo…');
    if(!m.ok)return linhaTx(simb('erro')+' '+esc(x.id.toUpperCase()),'fora','s-erro');
    var p=m.disco_pct;return'<div class="linha"><span class="k" title="'+esc(vpsNome(x)+' — '+(x.papel||[]).join(' · '))+'">'+esc(x.id.toUpperCase())+'</span><span class="v '+(p>=95?'s-erro':p>=90?'s-aviso':'')+'">disco '+(p!=null?p+'%':'?')+'</span></div>'}).join('');
  return{frase:fr,corpo:h||'<div class="sem">nenhuma VPS no inventário</div>'}},
 detalhe:function(d){var gb=function(mb){return mb==null?'–':(mb/1024).toFixed(1)};
  return sec('As VPS',tabela(['VPS','Onde','Disco','Memória (GB)','Carga','Containers','No ar há','O que roda'],(d.vps||[]).map(function(x){var m=x.medida||{},ok=x.medida&&m.ok;
    return[esc(vpsNome(x)),esc(x.local||'–'),ok?esc(m.disco||'')+' ('+m.disco_pct+'%)':(x.medida?'<span class="s-erro">'+esc(m.erro||'sem resposta')+'</span>':'medindo…'),
      ok?gb(m.ram_mb)+' / '+gb(m.ram_total_mb):'–',ok&&m.carga!=null?m.carga+(m.cpus?' em '+m.cpus+' CPU':''):'–',ok&&m.containers!=null?m.containers:'–',ok?esc(m.uptime||'–'):'–',esc((x.papel||[]).join(' · '))]})),true)
    +'<p class="nota">Leitura por SSH só de consulta (df, free, carga, docker ps) a cada 10 min, tentando as chaves padrão, _inema e _vps. Inventário: vps.json da telemetria; detalhes e acessos em wifi/VPS.md.</p>'}};

// Outras APIs (10/11/2026): uso medido pelo v3 + o que está liberado (painel-apis.json) + avisos de login.
var SIT={'liberada':'ok','só leitura':'info','pedir antes':'aviso','desligada':'erro'};
G.apis={tile:function(d){var hj=d.hoje||[],ch=hj.reduce(function(s,x){return s+x.chamadas},0),tot=hj.reduce(function(s,x){return s+x.usd},0);
  var fr='<p class="frase">'+plural(ch,'chamada','chamadas')+' hoje · '+usd(tot)+'</p>';
  var h=hj.slice(0,4).map(function(x){return linha(esc(x.provedor),x.chamadas+' · '+usd(x.usd))}).join('');
  var lib=(d.apis||[]).filter(function(a){return a.situacao==='liberada'}).length;if((d.apis||[]).length)h+=linha('Liberadas',lib+' de '+d.apis.length);
  (d.avisos||[]).forEach(function(a){h+=linhaTx(simb(a.vencido||a.nivel==='erro'?'erro':a.nivel==='info'?'info':'aviso')+' '+esc(a.titulo),a.ate?('até '+esc(a.ate.split('-').reverse().slice(0,2).join('/'))):'')});
  return{frase:fr,corpo:h||'<div class="sem">nada medido hoje</div>'}},
 detalhe:function(d){var lin=function(l){return l.map(function(x){return[esc(x.provedor),x.chamadas,usd(x.usd)]})};
  return sec('Uso hoje (bot v3)',tabela(['Provedor','Chamadas','Custo'],lin(d.hoje||[])))+sec('Uso em 7 dias (bot v3)',tabela(['Provedor','Chamadas','Custo'],lin(d.semana||[])))
  +sec('O que está liberado',tabela(['API','Para quê','Situação','Nota'],(d.apis||[]).map(function(a){return[esc(a.nome),esc(a.para),simb(SIT[a.situacao]||'info')+' '+esc(a.situacao),esc(a.nota||'')]}))+'<p class="nota">Espelha a regra do CLAUDE.md: API fora de "liberada" só com o seu OK. Edite em ~/.config/inema/painel-apis.json.</p>',true)
  +sec('Avisos de login e prazos',tabela(['Aviso','Prazo','Faltam'],(d.avisos||[]).map(function(a){return[esc(a.titulo),esc(a.ate||'–'),a.vencido?'<span class="s-erro">✕ passou</span>':a.dias!=null?plural(a.dias,'dia','dias'):'–']}))+'<p class="nota">Edite em ~/.config/inema/painel-avisos.json (lista de {titulo, ate, nivel}).</p>')+'<p class="nota">Só o que o bot v3 registra. Saldo de serviço externo (HeyGen, Magnific, Kling) não é consultado: isso exigiria chamar a API.</p>'}};

G.sites={tile:function(d){if(d.desligado)return{frase:'<p class="frase vazia">checagem desligada</p>',corpo:'<div class="sem">PAINEL_SITES=0</div>'};
  if(d.checando)return{frase:'<p class="frase vazia">checando os sites…</p>',corpo:''};
  var fora=d.sites.filter(function(s){return!s.ok});
  var fr=fora.length?'<p class="frase s-erro">'+plural(fora.length,'site fora','sites fora')+'</p>':'<p class="frase">'+d.sites.length+' de '+d.sites.length+' no ar</p>';
  var l=fora.concat(d.sites.filter(function(s){return s.ok}));
  return{frase:fr,corpo:l.slice(0,5).map(function(s){return linhaTx(simb(s.ok?'ok':'erro')+' '+esc(host(s.url)),s.ok?(s.ms+' ms'):esc(s.erro||'fora'),s.ok?'mut':'s-erro')}).join('')+mais(l.length,5)}},
 detalhe:function(d){return sec('Sites',tabela(['Site','Estado','HTTP','Tempo'],d.sites.map(function(s){return['<a href="'+esc(s.url)+'" target="_blank" rel="noopener">'+esc(host(s.url))+'</a>',s.ok?'<span class="s-ok">✓ no ar</span>':'<span class="s-erro">✕ '+esc(s.erro||'fora')+'</span>',s.status||'–',s.ms!=null?s.ms+' ms':'–']}))+'<p class="nota">Um GET por site a cada 5 min enquanto o painel está aberto. Checado '+quando(d.checado_em)+'. Lista em ~/.config/inema/painel-sites.json.</p>',1)}};

G.vagas={tile:function(d){var cl=d.classes;
  var fr=cl.length?'<p class="frase">'+cl.filter(function(c){return c.ocupadas}).length+' de '+cl.length+' classes em uso</p>':'<p class="frase vazia">vagas ainda não configuradas</p>';
  var h=cl.slice(0,5).map(function(c){return linha(esc(c.classe),(c.ocupadas!=null?c.ocupadas:'–')+' de '+(c.vagas!=null?c.vagas:'–')+(c.dono?' · '+esc(c.dono):''),c.ocupadas&&c.vagas&&c.ocupadas>=c.vagas?'s-aviso':'')}).join('');
  h+='<div class="sem">'+(d.pode_mudar?'clique para mudar':'só leitura: '+esc(d.motivo_so_leitura||''))+'</div>';
  return{frase:fr,corpo:h}},
 detalhe:function(d){var pode=d.pode_mudar&&(d.por_sessao||!!tok());
  var h=d.classes.length?d.classes.map(function(c){var v=c.vagas||0,teto=c.teto;
    return'<div class="vaga"><span class="nome">'+esc(c.classe)+'</span><span class="info mut">'+(c.ocupadas!=null?c.ocupadas+' em uso':'uso desconhecido')+(c.dono?' por '+esc(c.dono):'')+(c.esperando?', '+c.esperando+' esperando':'')+(teto!=null?' · teto '+teto:' · sem teto')+(c.classe==='gpu'&&v>1?'<div class="nota aviso">! máquina só medida estável com 1</div>':'')+'</span>'
    +'<span class="passo"><button class="btn" aria-label="Diminuir '+esc(c.classe)+'" data-vaga="'+esc(c.classe)+':'+(v-1)+'"'+(!pode||v<=1?' disabled':'')+'>−</button><output>'+(c.vagas!=null?v:'–')+'</output><button class="btn" aria-label="Aumentar '+esc(c.classe)+'" data-vaga="'+esc(c.classe)+':'+(v+1)+'"'+(!pode||teto==null||v>=teto?' disabled':'')+'>+</button></span></div>'}).join(''):'<p class="sem">sem vagas.json nem fila-vaga ainda</p>';
  if(E.msgVaga)h+='<p class="nota">'+esc(E.msgVaga)+'</p>';
  if(!d.pode_mudar)h+='<p class="nota">Só leitura: '+esc(d.motivo_so_leitura||'')+'. Para mudar agora, '+esc(d.dica)+'.</p>';
  else if(!d.por_sessao&&!tok())h+='<p class="nota">Informe o token abaixo para liberar os botões.</p>';
  var tk='<p class="nota">O token (DASHBOARD_TOKEN_V3) fica só neste navegador e vai no cabeçalho Bearer.</p><div class="ctl"><input type="password" id="tok" aria-label="Token do painel" value=""><button class="btn" id="tok-salvar">Guardar token</button></div>';
  var it=d.internas,tab=function(o){return o?tabela(['Fila','Ao mesmo tempo'],Object.keys(o).map(function(k){return[esc(k),o[k]]})):'<p class="sem">sem dados</p>'};
  return sec('Vagas por classe',h,1)+(d.por_sessao?'':sec('Token',tk))+sec('Concorrência interna do openpcbotv3 (só leitura)',tab(it.openpcbotv3))+sec('Concorrência interna do inemaccbot (só leitura)',tab(it.inemaccbot))}};

function pastaCurta(c){return String(c||'').replace(/^\/home\/[^\/]+\//,'~/')}
function termProj(t){var r=t.retrato||{};return r.ativo||t.projeto||'?'}
function termLinhas(t){var r=t.retrato||{},x=t.transcript||{},at=x.ultima_atividade||r.em||t.inicio;
  return'<span class="tl">📁 '+esc(pastaCurta(t.cwd))+'</span><span class="tl">🧠 '+esc((r.modelo||x.modelo||'modelo ?')+(r.esforco?' / '+r.esforco:''))+(r.ctx_pct!=null?' · contexto '+r.ctx_pct+'%':'')+'</span><span class="tl">⏱ ativo '+(at?ha(at):'–')+(t.inicio?' · aberta há '+dur(Date.now()/1000-t.inicio):'')+'</span>'}
function termTit(t){var o=t.origem||{},r=t.retrato||{};return(o.tipo==='fisica'?'👤 ':o.tipo==='agente'?'🤖 ':'')+'<b>'+esc(termProj(t))+'</b>'+(r.nome?' <span class="fraco">· '+esc(r.nome)+'</span>':'')+(t.tmux?' <span class="fraco">· tmux</span>':'')}
function modoTerminais(l,max){l=l.slice(0,max);if(!l.length)return'<p class="sem">nenhuma sessão aberta</p>';
  if(E.modo==='icones')return'<div class="tics">'+l.map(function(t){var p=termProj(t);return'<div class="tic" data-sessao="'+esc(t.session_id)+'"><b style="background:'+cor(p)+'">'+esc(inicial(p))+'</b><div><div class="tt">'+termTit(t)+'</div>'+termLinhas(t)+'</div></div>'}).join('')+'</div>';
  if(E.modo==='imagens')return'<div class="tcards">'+l.map(function(t){var p=termProj(t);return'<div class="tcard" data-sessao="'+esc(t.session_id)+'"><div class="img" style="background:'+cor(p)+'">'+esc(inicial(p))+'</div><div class="txt"><div class="tt">'+termTit(t)+'</div>'+termLinhas(t)+'</div></div>'}).join('')+'</div>';
  return'<div class="terms">'+l.map(function(t){return'<div class="term" data-sessao="'+esc(t.session_id)+'"><div class="tt">'+termTit(t)+'</div>'+termLinhas(t)+'</div>'}).join('')+'</div>'}
// Quadro da visão geral: cada sessão em 2 linhas (cabem ~12); os cartões completos ficam no detalhe.
function termCurto(t){var p=termProj(t),r=t.retrato||{},x=t.transcript||{},o=t.origem||{},at=x.ultima_atividade||r.em||t.inicio,c=r.ctx_pct;
  var ini=E.modo==='icones'?'<b class="tci" style="background:'+cor(p)+'">'+esc(inicial(p))+'</b>':'';
  return'<div class="tc'+(E.modo==='imagens'?' tcimg':'')+'" data-sessao="'+esc(t.session_id)+'" style="--c:'+cor(p)+'">'+ini+'<div class="tcx"><div class="tc1">'+(o.tipo==='fisica'?'👤 ':o.tipo==='agente'?'🤖 ':'')+'<b>'+esc(p)+'</b>'+(r.nome?' <span class="fraco">· '+esc(r.nome)+'</span>':'')+'</div>'
   +'<div class="tc2">'+(c!=null?'<span class="'+(c>=85?'s-erro':c>=70?'s-aviso':'')+'">'+c+'%</span> · ':'')+(at?ha(at):'–')+' · '+esc((r.modelo||x.modelo||'?')+(r.esforco?'/'+r.esforco:''))+' · '+esc(pastaCurta(t.cwd))+'</div></div></div>'}
function ordTerm(l){return l.slice().sort(function(a,b){var fa=(a.transcript||{}).ultima_atividade||(a.retrato||{}).em||a.inicio||0,fb=(b.transcript||{}).ultima_atividade||(b.retrato||{}).em||b.inicio||0;return fb-fa})}
G.terminais={tile:function(d,g){var v=d.vivos,i=d.interrompidos,semT=g.ausentes&&g.ausentes.indexOf('terminais')>=0;
  var fr=semT?'<p class="frase vazia">comando terminais ainda não instalado</p>':'<p class="frase">'+plural(v.length,'sessão aberta','sessões abertas')+(i.length?', <span class="s-aviso">'+plural(i.length,'interrompida','interrompidas')+'</span>':'')+'</p>';
  return{frase:fr,corpo:v.length?'<div class="tcs">'+ordTerm(v).map(termCurto).join('')+'</div>':'<p class="sem">nenhuma sessão aberta</p>'}},
 detalhe:function(d){return sec('Sessões abertas — clique no projeto para ver tudo, visualizar ou assumir',true?tabela(['Projeto','Quem abriu','Modelo','Contexto','Custo','Último pedido','Ativo há',''],d.vivos.map(function(t){var o=t.origem||{},r=t.retrato||{},x=t.transcript||{};return['<button class="link" data-sessao="'+esc(t.session_id)+'">'+esc(t.projeto)+'</button>'+(r.ativo?' <span class="mut">→ '+esc(r.ativo)+'</span>':'')+'<br><span class="fraco">'+esc(pastaCurta(t.cwd))+'</span>',(o.tipo==='fisica'?'👤 ':o.tipo==='agente'?'🤖 ':'')+esc(o.quem||t.tipo),esc((r.modelo||x.modelo||'–')+(r.esforco?' / '+r.esforco:'')),r.ctx_pct!=null?r.ctx_pct+'%':'–',r.custo_usd!=null?usd(r.custo_usd):'–','<span class="mut">'+esc(x.ultimo_pedido||'–')+'</span>',t.inicio?dur(Date.now()/1000-t.inicio):'–','<button class="link" data-sessao="'+esc(t.session_id)+'">dados</button> · <button class="link" data-sessao="'+esc(t.session_id)+'" data-aba-ini="conversa">conteúdo</button>'+(t.tmux?' · <button class="link" data-sessao="'+esc(t.session_id)+'" data-aba-ini="terminal">terminal</button>':'')]})):modoTerminais(d.vivos,200),1)
  +sec('Interrompidas',tabela(['Projeto','Sessão','Pasta'],d.interrompidos.map(function(t){return['<button class="link" data-sessao="'+esc(t.session_id)+'">'+esc(t.projeto)+'</button>','<span class="mut">'+esc(t.session_id.slice(0,8))+'</span>',esc(t.cwd)]})),1)}};

G.esperando={tile:function(d){var it=d.itens,urg=it.filter(function(x){return x.tipo!=='pendencia'}),pend=it.filter(function(x){return x.tipo==='pendencia'});
  var fr=urg.length?'<p class="frase'+(urg.some(function(x){return x.nivel==='erro'})?' s-erro':'')+'">'+plural(urg.length,'coisa esperando você','coisas esperando você')+'</p>':'<p class="frase">Nada urgente esperando você</p>';
  var h=urg.slice(0,7).map(function(x){return linhaTx(simb(x.nivel)+' '+esc(x.texto),'')}).join('')+mais(urg.length,7);
  if(pend.length)h+='<div class="k mut" style="margin-top:.5rem">Pendências do hub</div>'+pend.slice(0,Math.max(2,9-Math.min(urg.length,7))).map(function(x){return linhaTx('<span class="fraco">·</span> '+esc(x.texto),'')}).join('');
  return{frase:fr,corpo:h}},
 detalhe:function(d){var it=d.itens;return sec('Pedem você agora',tabela(['','Item','Onde'],it.filter(function(x){return x.tipo!=='pendencia'}).map(function(x){return[simb(x.nivel),esc(x.texto),'<button class="link" data-abrir="'+esc(x.grupo)+'">'+esc(NOMES[x.grupo]||x.grupo)+'</button>']})),1)
  +sec('Pendências do hub (topo de pendencias.md)',tabela(['Item'],it.filter(function(x){return x.tipo==='pendencia'}).map(function(x){return[esc(x.texto)]})),1)}};

// ---------- Sessão dentro do painel clássico (3.17.7): abas Dados · Conteúdo · Terminal ----------
E.sessao=null;E.aba='dados';E.timer=null;
var QUEMC={voce:'você',claude:'claude',ferramenta:'ferramenta',resultado:'resultado'};
function sessaoAchar(sid){var t=(E.dados&&E.dados.grupos.terminais&&E.dados.grupos.terminais.dados)||{};var v=(t.vivos||[]).filter(function(s){return s.session_id===sid})[0];if(v)return{s:v,viva:true,assumir:!!t.assumir};var i=(t.interrompidos||[]).filter(function(s){return s.session_id===sid})[0];return i?{s:i,viva:false,assumir:false}:null}
function pararSessao(){if(E.timer){clearInterval(E.timer);E.timer=null}}
function sessaoDados(t,viva){var o=t.origem||{},r=t.retrato||{},x=t.transcript||{},p=t.processo;var ent={cli:'aberta à mão (claude no terminal)','sdk-cli':'automática (claude -p, sem tela)'}[t.entrada]||t.entrada||'–';
  return sec('Quem abriu e controla',linha('Tipo',o.tipo==='fisica'?'👤 física (você)':o.tipo==='agente'?'🤖 agente':'desconhecido')+linha('Quem',esc(o.quem||'–'))+(o.unidade?linha('Unidade',esc(o.unidade)):'')+linha('Como entrou',esc(ent))+((o.cadeia||[]).length?linha('Processos pais','<span class="mut">'+esc(o.cadeia.join('  ←  '))+'</span>'):'')+linha('Estado',viva?'✓ viva':'<span class="s-aviso">! interrompida</span>')+linha('Terminal no tmux',t.tmux?'✓ sim (dá para ver e assumir)':'não (aberta com cc)'))
   +sec('Sessão',(r.nome?linha('Nome',esc(r.nome)):'')+linha('Projeto',esc(t.projeto||'?'))+(r.ativo?linha('Mexendo agora em',esc(r.ativo)):'')+linha('Pasta','<span class="mut">'+esc(t.cwd||'–')+'</span>')+linha('Terminal',esc(t.tty||'sem terminal'))+linha('Aberta',quando(t.inicio)+' ('+ha(t.inicio)+')')+linha('Id','<span class="mut">'+esc(t.session_id)+'</span>'))
   +sec('Modelo e uso',linha('Modelo',esc((r.modelo||x.modelo||'–')+(r.esforco?' / '+r.esforco:'')))+(r.ctx_pct!=null?linha('Contexto',barra(r.ctx_pct,85)+' '+r.ctx_pct+'%'+(r.ctx_tokens?' <span class="mut">('+n(r.ctx_tokens/1000,0)+' mil de '+n((r.ctx_janela||0)/1000,0)+' mil)</span>':'')):'')+(r.custo_usd!=null?linha('Custo equivalente',usd(r.custo_usd)):'')+(r.dur_ms?linha('Tempo total',dur(r.dur_ms/1000)):'')+(r.api_ms?linha('Tempo do modelo',dur(r.api_ms/1000)):'')+(r.linhas_mais!=null?linha('Linhas mudadas','+'+r.linhas_mais+' / −'+(r.linhas_menos||0)):'')+(r.versao?linha('Claude Code',esc(r.versao)):'')+(r.em?'':'<p class="sem">sem retrato da barra de status (claude -p ou ainda não desenhou)</p>'))
   +(p?sec('Processo',linha('CPU',n(p.cpu)+'%')+linha('Memória',n(p.mem_mb,0)+' MB')+linha('Rodando há',dur(p.rodando_s))):'')
   +sec('Conversa (resumo)',linha('Última atividade',x.ultima_atividade?quando(x.ultima_atividade)+' ('+ha(x.ultima_atividade)+')':'–')+linhaTx('<b>Último pedido:</b> '+esc(x.ultimo_pedido||'–'),'')+linhaTx('<b>Última resposta:</b> '+esc(x.ultima_resposta||'–'),''),1)}
function sessaoHtml(){var a=sessaoAchar(E.sessao);if(!a)return sec('Sessão','<p class="sem">esta sessão não está mais na lista</p><button class="btn" id="c-voltar">← Voltar à lista</button>',1);
  var t=a.s,abas=[['dados','Dados'],['conversa','Conteúdo (só leitura)'],['terminal','Terminal (ver e digitar)']];
  var h='<div class="sec larga"><div class="abas"><button class="btn" id="c-voltar">← Lista</button>'+abas.map(function(b){return'<button class="btn" data-aba="'+b[0]+'" aria-pressed="'+(E.aba===b[0])+'">'+b[1]+'</button>'}).join('')+'<a class="link" href="/jarvis#term:'+esc(t.session_id)+'" style="margin-left:auto">abrir no Jarvis</a></div></div>';
  if(E.aba==='dados')return h+sessaoDados(t,a.viva);
  if(E.aba==='conversa')return h+sec('Conteúdo da conversa — atualiza a cada 5 s','<div id="c-conv" class="convc"><p class="sem">carregando…</p></div>',1);
  if(!a.viva)return h+sec('Terminal','<p class="sem">sessão interrompida: não há terminal para ver.</p>',1);
  if(!t.tmux)return h+sec('Terminal','<p>Ver a tela e digitar só funcionam em sessões abertas com <b>cct</b> (o cc dentro do tmux): <code>cct '+esc(t.projeto||'projeto')+'</code> ou <code>../cct.sh</code> dentro do projeto. Esta foi aberta com cc; use a aba Conteúdo para ler a conversa.</p>',1);
  return h+sec('Tela ao vivo — atualiza a cada 2 s','<pre id="c-tela">carregando…</pre>'+(a.assumir?'<div class="assumirc"><p class="mut" style="margin:.5rem 0 .3rem">Digitar NESTA sessão'+((t.origem||{}).tipo==='fisica'?' (a mesma que está no seu terminal)':'')+'. Enter envia; Shift+Enter quebra linha.</p><textarea id="c-texto" rows="3" placeholder="Escreva o pedido para esta sessão…"></textarea><div class="abas"><button class="btn quente" data-env="texto">Enviar</button><button class="btn" data-env="Escape">Esc (parar)</button><button class="btn" data-env="C-c">Ctrl+C</button><button class="btn" data-env="Up">↑</button><button class="btn" data-env="Down">↓</button><button class="btn" data-env="Enter">Enter</button><span class="mut" id="c-msg"></span></div></div>':'<p class="sem">Assumir desligado (PAINEL_ASSUMIR=1 no .env do v3).</p>'),1)}
async function sessaoConv(){var c=document.getElementById('c-conv');if(!c)return;try{var r=await fetch('/api/painel/terminal?id='+encodeURIComponent(E.sessao)+'&n=150',{headers:hdr(),cache:'no-store'});var j=await r.json();
  if(!r.ok){c.innerHTML='<p class="sem">'+esc(j.erro||('HTTP '+r.status))+'</p>';return}var fim=c.scrollTop+c.clientHeight>=c.scrollHeight-30;
  c.innerHTML=(j.mensagens||[]).map(function(m){return'<div class="mc '+m.quem+'"><span>'+QUEMC[m.quem]+(m.quando?' · '+hm(m.quando):'')+'</span><p>'+esc(m.texto)+'</p></div>'}).join('')||'<p class="sem">sem mensagens</p>';if(fim||!c.dataset.ja){c.scrollTop=c.scrollHeight;c.dataset.ja='1'}}catch(e){c.innerHTML='<p class="sem">não consegui ler: '+esc(e.message)+'</p>'}}
async function sessaoTela(){var c=document.getElementById('c-tela');if(!c)return;try{var r=await fetch('/api/painel/terminal/tela?id='+encodeURIComponent(E.sessao),{headers:hdr(),cache:'no-store'});var j=await r.json();c.textContent=r.ok?j.tela:(j.erro||('HTTP '+r.status));c.scrollTop=c.scrollHeight}catch(e){c.textContent='não consegui ler a tela: '+e.message}}
function sessaoMostrar(){pararSessao();var c=document.getElementById('folha-conteudo');var h=sessaoHtml();c.innerHTML=h;E.folha=h;
  if(E.aba==='conversa'){sessaoConv();E.timer=setInterval(sessaoConv,5000)}else if(E.aba==='terminal'&&document.getElementById('c-tela')){sessaoTela();E.timer=setInterval(sessaoTela,2000);var tx=document.getElementById('c-texto');if(tx)tx.focus()}}
var confirmouC=false;
async function sessaoEnviar(corpo){var m=document.getElementById('c-msg');if(!confirmouC&&!confirm('Digitar nesta sessão? O que você mandar vai direto para o Claude, que roda sem pedir permissão.'))return;confirmouC=true;if(m)m.textContent='enviando…';
  try{var r=await fetch('/api/painel/terminal/enviar',{method:'POST',headers:Object.assign({'Content-Type':'application/json','X-Painel':'1'},hdr()),body:JSON.stringify(Object.assign({id:E.sessao},corpo))});var j=await r.json();if(m)m.textContent=r.ok?'enviado às '+new Date().toLocaleTimeString('pt-BR'):('não foi: '+(j.erro||('HTTP '+r.status)));if(r.ok)setTimeout(sessaoTela,600)}catch(e){if(m)m.textContent='não foi: '+e.message}}
if(typeof document!=='undefined')document.addEventListener('click',function(ev){var t=ev.target.closest('[data-sessao],[data-aba],[data-env],#c-voltar');if(!t)return;ev.preventDefault();
  if(t.dataset.sessao){ev.stopImmediatePropagation();var sid=t.dataset.sessao,aba=t.dataset.abaIni||'dados';if(E.aberto!=='terminais')abrir('terminais');E.sessao=sid;E.aba=aba;sessaoMostrar();return}
  if(t.id==='c-voltar'){pararSessao();E.sessao=null;desenharFolha(true);return}
  if(t.dataset.aba){E.aba=t.dataset.aba;sessaoMostrar();return}
  if(t.dataset.env==='texto'){var tx=document.getElementById('c-texto');if(tx&&tx.value.trim()){sessaoEnviar({texto:tx.value});tx.value='';tx.focus()}return}
  if(t.dataset.env)sessaoEnviar({tecla:t.dataset.env})});
if(typeof document!=='undefined')document.addEventListener('keydown',function(ev){if(ev.target&&ev.target.id==='c-texto'&&ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();if(ev.target.value.trim()){sessaoEnviar({texto:ev.target.value});ev.target.value=''}}},true);
`;
