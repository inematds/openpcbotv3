// JS do cliente, parte 2: como cada grupo aparece no cartão (tile) e no
// detalhe. Modo lista / ícones / imagens vale para Produção, Publicação e Terminais.
export const JS_GRUPOS = String.raw`
var G={};
G.maquina={tile:function(d){var m=d.memoria,k=d.disco,c=d.carga,gp=d.gpu_oom,h='';
  var fr=m?'<p class="frase">'+n(m.disponivel_gb)+' GB livres de '+n(m.total_gb,0)+'</p>':'<p class="frase vazia">sem leitura de memória</p>';
  if(m)h+='<div class="linha"><span class="k">Memória em uso</span>'+barra(100*(1-m.disponivel_gb/m.total_gb),95)+'<span class="v">'+Math.round(100*(1-m.disponivel_gb/m.total_gb))+'%</span></div>';
  if(k)h+='<div class="linha"><span class="k">Disco</span>'+barra(k.usado_pct,90)+'<span class="v">'+k.usado_pct+'% · '+k.livre_gb+' GB livres</span></div>';
  if(c)h+=linha('Carga',n(c.m1,2)+' em '+c.nucleos+' núcleos');
  h+=linha('Ligada',d.boot_em?ha(d.boot_em):'–');
  h+=linha('GPU sem memória',gp.erro?esc(gp.erro):gp.ultimas_24h?(gp.ultimas_24h+' em 24 h, última '+hm(gp.ultima_em)):'nenhum em 24 h',gp.ultima_hora?'s-erro':gp.ultimas_24h?'s-aviso':'');
  return{frase:fr,corpo:h}},
 detalhe:function(d){var m=d.memoria||{},k=d.disco||{},c=d.carga||{},gp=d.gpu_oom;
  return sec('Agora',tabela(['Medida','Valor'],[['Memória disponível',n(m.disponivel_gb)+' GB de '+n(m.total_gb,0)+' GB'],['Swap em uso',n(m.swap_usado_gb)+' GB'],['Disco da raiz',(k.usado_pct??'–')+'% usado, '+(k.livre_gb??'–')+' GB livres de '+(k.total_gb??'–')],['Carga 1/5/15 min',n(c.m1,2)+' / '+n(c.m5,2)+' / '+n(c.m15,2)+' ('+(c.nucleos||'–')+' núcleos)'],['Ligada desde',quando(d.boot_em)+' ('+ha(d.boot_em)+')']]))
  +sec('Reinícios recentes',d.reinicios.erro?'<p class="sem">'+esc(d.reinicios.erro)+'</p>':tabela(['Início do boot'],d.reinicios.em.slice().reverse().map(function(t){return[quando(t)+' <span class="mut">('+ha(t)+')</span>']})))
  +sec('GPU sem memória (kernel, 24 h)',gp.erro?'<p class="sem">'+esc(gp.erro)+'</p>':tabela(['Últimas 24 h','Última hora','Último'],[[gp.ultimas_24h,gp.ultima_hora,quando(gp.ultima_em)]]))}};

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
function modoRodadas(lista,max,horiz){var l=lista.slice(0,max);if(!l.length)return'<p class="sem">nenhuma rodada registrada hoje</p>';
  if(E.modo==='icones')return'<div class="icones">'+l.map(function(r){var e=rodadaEstado(r);return ico(inicial(r.unidade),r.unidade,cor(r.unidade),e[0]==='erro',r.unidade+': '+e[1])}).join('')+'</div>';
  if(E.modo==='imagens')return'<div class="cartoes'+(horiz?' horiz':'')+'">'+l.map(function(r){var e=rodadaEstado(r);return cartao(null,inicial(r.unidade),cor(r.unidade),r.unidade,(e[0]==='erro'?'✕ ':e[0]==='ok'?'✓ ':'… ')+e[1]+' · '+hm(r.inicio||r.fim),e[0]==='erro')}).join('')+'</div>';
  return l.map(function(r){var e=rodadaEstado(r);return linhaTx(simb(e[0])+' '+esc(r.unidade)+' <span class="fraco">'+hm(r.inicio||r.fim)+'</span>',esc(e[1]),'s-'+e[0])}).join('')}
G.producao={tile:function(d,g){var h=d.hoje,feitas=h.filter(function(r){return r.fim!=null}).length,sem=g.ausentes&&g.ausentes.indexOf('rodadas.jsonl')>=0;
  var fr=d.presas.length?'<p class="frase s-erro">'+plural(d.presas.length,'rodada parada','rodadas paradas')+'</p>':sem?'<p class="frase vazia">placar de rodadas ainda não existe</p>':h.length?'<p class="frase">'+feitas+' de '+h.length+' rodadas fechadas</p>':'<p class="frase vazia">nenhuma rodada hoje</p>';
  var mx=E.modo==='lista'?4:E.modo==='icones'?8:2;
  var c=modoRodadas(d.presas.concat(h.filter(function(r){return!r.presa})),mx,true);
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
function resumoFilas(fs,curto){if(curto){var t=fs.filter(function(f){return f.por_estado.pendente||f.erros_recentes.length}).map(function(f){return esc(f.nome)+' '+(f.por_estado.pendente||0)+(f.erros_recentes.length?' <span class="s-aviso">! erro</span>':'')});return linha('Filas pendentes',t.length?t.join(', '):'nada pendente')}
  return fs.map(function(f){var p=f.por_estado,er=f.erros_recentes.length;return linha('Fila '+esc(f.nome),(p.pendente?p.pendente+' pendentes':'nada pendente')+(er?', <span class="s-aviso">'+er+' com erro recente</span>':''))}).join('')}
G.publicacao={tile:function(d){var fr='<p class="frase">'+plural(d.hoje,'vídeo publicado hoje','vídeos publicados hoje')+'</p>',c;
  if(E.modo==='icones'){var cs=Object.keys(d.semana_por_canal).slice(0,4);c=cs.length?'<div class="icones">'+cs.map(function(k){return ico(String(d.semana_por_canal[k]),k,cor(k),false,k+': '+d.semana_por_canal[k]+' em 7 dias')}).join('')+'</div><div class="fraco" style="font-size:.85rem">envios por canal, últimos 7 dias</div>':'<p class="sem">nenhum envio em 7 dias</p>'}
  else c=modoUploads(d.ultimos,E.modo==='imagens'?2:3,true);
  return{frase:fr,corpo:c+resumoFilas(d.filas,E.modo!=='lista')}},
 detalhe:function(d){var cs=Object.keys(d.semana_por_canal);
  return sec('Últimos envios',E.modo==='lista'?tabela(['Quando','Canal','Título'],d.ultimos.map(function(u){return[quando(u.quando),esc(u.canal),u.url?'<a href="'+esc(u.url)+'" target="_blank" rel="noopener">'+esc(u.titulo)+'</a>':esc(u.titulo)]})):modoUploads(d.ultimos,10),1)
  +sec('Por canal',tabela(['Canal','Hoje','7 dias'],cs.map(function(k){return[esc(k),d.hoje_por_canal[k]||0,d.semana_por_canal[k]]})))
  +sec('Filas de publicação',tabela(['Fila','Total','Por estado'],d.filas.map(function(f){return[esc(f.nome),f.total,Object.keys(f.por_estado).map(function(k){return esc(k)+' '+f.por_estado[k]}).join(', ')]}))+d.filas.map(function(f){return f.erros_recentes.length?'<h3 style="margin-top:.8rem">Erros recentes na fila '+esc(f.nome)+'</h3>'+tabela(['Item','Erro'],f.erros_recentes.map(function(e){return[esc(e.nome),esc(e.erro)]})):''}).join(''))}};

G.creditos={tile:function(d){var l=d.claude.limites,sem7=l.filter(function(x){return/todos/.test(x.nome)})[0]||l[0];
  var fr=sem7?'<p class="frase">Claude em '+sem7.pct+'% da semana</p>':'<p class="frase vazia">sem leitura dos limites</p>';
  var h=l.map(function(x){return'<div class="linha"><span class="k">'+esc(x.nome)+'</span>'+barra(x.pct,80)+'<span class="v">'+x.pct+'%</span></div>'}).join('');
  if(d.codex)h+='<div class="linha"><span class="k">Codex</span>'+barra(d.codex.pct,80)+'<span class="v">'+d.codex.pct+'%</span></div>';
  if(d.claude.idade_s!=null)h+=linha('Medida do Claude','há '+dur(d.claude.idade_s),d.claude.idade_s>6*3600?'s-aviso':'');
  var tot=d.custo_hoje.reduce(function(s,x){return s+x.usd},0);h+=linha('Custo do v3 hoje',usd(tot));
  d.avisos.forEach(function(a){h+=linhaTx(simb(a.vencido||a.nivel==='erro'?'erro':a.nivel==='info'?'info':'aviso')+' '+esc(a.titulo),a.ate?('até '+esc(a.ate.split('-').reverse().slice(0,2).join('/'))):'')});
  return{frase:fr,corpo:h}},
 detalhe:function(d){return sec('Claude',tabela(['Limite','Usado','Volta a zero'],d.claude.limites.map(function(x){return[esc(x.nome),x.pct+'%',quando(x.reset_em)]}))+'<p class="nota">Medida gravada pela statusline '+(d.claude.idade_s!=null?'há '+dur(d.claude.idade_s):'(sem arquivo)')+'.</p>')
  +sec('Codex',d.codex?tabela(['Medida','Valor'],[['Usado',d.codex.pct+'%'+(d.codex.janela_h?' da janela de '+d.codex.janela_h+' h':'')],['Volta a zero',quando(d.codex.reset_em)],['Plano',esc(d.codex.plano||'–')],['Registro lido','há '+dur(d.codex.idade_s)]]):'<p class="sem">sem dados</p>')
  +sec('Custo do v3 hoje por provedor',tabela(['Provedor','Chamadas','Custo'],d.custo_hoje.map(function(x){return[esc(x.provedor),x.chamadas,usd(x.usd)]})))
  +sec('Avisos manuais',tabela(['Aviso','Prazo','Faltam'],d.avisos.map(function(a){return[esc(a.titulo),esc(a.ate||'–'),a.vencido?'<span class="s-erro">✕ passou</span>':a.dias!=null?plural(a.dias,'dia','dias'):'–']}))+'<p class="nota">Edite em ~/.config/inema/painel-avisos.json (lista de {titulo, ate, nivel}).</p>')}};

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

function modoTerminais(l,max){l=l.slice(0,max);if(!l.length)return'<p class="sem">nenhuma sessão aberta</p>';
  if(E.modo==='icones')return'<div class="icones">'+l.map(function(t){return ico(inicial(t.projeto),t.projeto,cor(t.projeto),false,t.projeto+' · '+t.tipo+' · '+ha(t.inicio))}).join('')+'</div>';
  // Imagens: hoje um cartão visual; quando houver miniatura real (t.miniatura) ela entra no lugar da cor.
  if(E.modo==='imagens')return'<div class="cartoes">'+l.map(function(t){return cartao(t.miniatura||null,inicial(t.projeto),cor(t.projeto),t.projeto,t.tipo+' · ativo '+(t.inicio?dur(Date.now()/1000-t.inicio):'–'))}).join('')+'</div>';
  return l.map(function(t){var o=t.origem||{},r=t.retrato||{};return linhaTx((o.tipo==='fisica'?'👤 ':o.tipo==='agente'?'🤖 ':'')+esc(t.projeto)+' <span class="fraco">'+esc(o.quem||t.tipo)+(r.modelo?' · '+esc(r.modelo):'')+(r.ctx_pct!=null?' · ctx '+r.ctx_pct+'%':'')+(t.tmux?' · tmux':'')+'</span>',t.inicio?dur(Date.now()/1000-t.inicio):'–','mut')}).join('')}
G.terminais={tile:function(d,g){var v=d.vivos,i=d.interrompidos,semT=g.ausentes&&g.ausentes.indexOf('terminais')>=0;
  var fr=semT?'<p class="frase vazia">comando terminais ainda não instalado</p>':'<p class="frase">'+plural(v.length,'sessão aberta','sessões abertas')+(i.length?', <span class="s-aviso">'+plural(i.length,'interrompida','interrompidas')+'</span>':'')+'</p>';
  var max=E.modo==='lista'?3:E.modo==='icones'?14:4;
  return{frase:fr,corpo:modoTerminais(v,max)+mais(v.length,max)}},
 detalhe:function(d){return sec('Sessões abertas — clique no projeto para ver tudo, visualizar ou assumir',true?tabela(['Projeto','Quem abriu','Modelo','Contexto','Custo','Último pedido','Ativo há',''],d.vivos.map(function(t){var o=t.origem||{},r=t.retrato||{},x=t.transcript||{};return['<a class="link" href="/jarvis#term:'+esc(t.session_id)+'">'+esc(t.projeto)+'</a>'+(r.ativo?' <span class="mut">→ '+esc(r.ativo)+'</span>':''),(o.tipo==='fisica'?'👤 ':o.tipo==='agente'?'🤖 ':'')+esc(o.quem||t.tipo),esc((r.modelo||x.modelo||'–')+(r.esforco?' / '+r.esforco:'')),r.ctx_pct!=null?r.ctx_pct+'%':'–',r.custo_usd!=null?usd(r.custo_usd):'–','<span class="mut">'+esc(x.ultimo_pedido||'–')+'</span>',t.inicio?dur(Date.now()/1000-t.inicio):'–','<a class="link" href="/jarvis#term:'+esc(t.session_id)+'">'+(t.tmux&&d.assumir?'ver · assumir':'ver tudo')+'</a>']})):modoTerminais(d.vivos,200),1)
  +sec('Interrompidas',tabela(['Projeto','Sessão','Pasta'],d.interrompidos.map(function(t){return[esc(t.projeto),'<span class="mut">'+esc(t.session_id.slice(0,8))+'</span>',esc(t.cwd)]})),1)}};

G.esperando={tile:function(d){var it=d.itens,urg=it.filter(function(x){return x.tipo!=='pendencia'}),pend=it.filter(function(x){return x.tipo==='pendencia'});
  var fr=urg.length?'<p class="frase'+(urg.some(function(x){return x.nivel==='erro'})?' s-erro':'')+'">'+plural(urg.length,'coisa esperando você','coisas esperando você')+'</p>':'<p class="frase">Nada urgente esperando você</p>';
  var h=urg.slice(0,7).map(function(x){return linhaTx(simb(x.nivel)+' '+esc(x.texto),'')}).join('')+mais(urg.length,7);
  if(pend.length)h+='<div class="k mut" style="margin-top:.5rem">Pendências do hub</div>'+pend.slice(0,Math.max(2,9-Math.min(urg.length,7))).map(function(x){return linhaTx('<span class="fraco">·</span> '+esc(x.texto),'')}).join('');
  return{frase:fr,corpo:h}},
 detalhe:function(d){var it=d.itens;return sec('Pedem você agora',tabela(['','Item','Onde'],it.filter(function(x){return x.tipo!=='pendencia'}).map(function(x){return[simb(x.nivel),esc(x.texto),'<button class="link" data-abrir="'+esc(x.grupo)+'">'+esc(NOMES[x.grupo]||x.grupo)+'</button>']})),1)
  +sec('Pendências do hub (topo de pendencias.md)',tabela(['Item'],it.filter(function(x){return x.tipo==='pendencia'}).map(function(x){return[esc(x.texto)]})),1)}};
`;
