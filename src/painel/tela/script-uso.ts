// JS do cliente: quadros INEMA.PRO e Portal (Nei, 14/11/2026). Dados do uso-inema (1×/dia, só contagens);
// "no ar" vem do quadro Sites (mesmo painel). Depois de JS_GRUPOS: usa G, linhaTx, sec, tabela, quando, n…
export const JS_USO = String.raw`
function usoSites(hosts){var s=(E.dados&&E.dados.grupos&&E.dados.grupos.sites&&E.dados.grupos.sites.dados&&E.dados.grupos.sites.dados.sites)||[];
  return s.filter(function(x){return hosts.some(function(h){return host(x.url)===h})})}
function usoNoAr(hosts){var s=usoSites(hosts);if(!s.length)return linhaTx('No ar','sem checagem','mut');
  var f=s.filter(function(x){return!x.ok});return linhaTx('No ar',f.length?'<span class="s-erro">✕ '+f.map(function(x){return esc(host(x.url))}).join(', ')+' fora</span>':'<span class="s-ok">✓ '+s.length+' de '+s.length+'</span>','mut')}
function usoGit(g){return g?linhaTx('O que fizemos',plural(g.commits_24h,'commit','commits')+' 24 h · '+g.commits_7d+' em 7 dias','mut')+(g.ultimos&&g.ultimos[0]?linhaTx('<span class="fraco">'+esc(g.ultimos[0].titulo.slice(0,70))+'</span>',''):''):''}
function usoGitDet(g){return g&&g.ultimos?sec('O que fizemos (git)',tabela(['Quando','Commit'],g.ultimos.map(function(c){return[quando(c.quando),esc(c.titulo)]}))+'<p class="nota">'+g.commits_24h+' commits nas últimas 24 h, '+g.commits_7d+' em 7 dias.</p>'):''}
function usoSem(d,g){if(g.ausentes&&g.ausentes.length)return{frase:'<p class="frase s-erro">sem leitura do uso-inema</p>',corpo:'<div class="sem">timer uso-inema (1×/dia) não gravou ~/.local/share/inema/uso-inema.json</div>'};return null}
function usoRodape(d){return linhaTx('<span class="fraco">atualizado</span>',quando(d.atualizado)+(d.parado?' <span class="s-aviso">(parado)</span>':''),'mut')}
function usoNota(d){return '<p class="nota">Leitura 1×/dia (07:10) pelo uso-inema (~/projetos/wifi/uso-inema): Supabase só leitura, só contagens, nenhum e-mail ou texto. Atualizado '+quando(d.atualizado)+'.</p>'+(d.erros&&d.erros.length?'<p class="s-aviso">Erros da leitura: '+d.erros.map(esc).join(' · ')+'</p>':'')}
var HOSTS_PRO=['inema.pro','pay.inema.pro','eventos.inema.pro','news.inema.pro'],HOSTS_PORTAL=['inema.club'];

G.inemapro={tile:function(d,g){var s=usoSem(d,g);if(s)return s;
  var rot=d.rotinas||[],er=rot.filter(function(r){return r.estado==='erro'}),a7=d.acessos_7d||{},a1=d.acessos_24h||{},st=a7.por_status||{},ia=d.ia_7d||{},p=(d.areas||{}).pro||{};
  var fora=usoSites(HOSTS_PRO).filter(function(x){return!x.ok});
  var fr=fora.length?'<p class="frase s-erro">'+esc(host(fora[0].url))+' fora do ar</p>':er.length?'<p class="frase s-aviso">'+esc(er[0].nome)+' falhou</p>':'<p class="frase">'+plural(a7.pessoas||0,'pessoa logada','pessoas logadas')+' em 7 dias</p>';
  return{frase:fr,corpo:usoNoAr(HOSTS_PRO)
    +linhaTx('Rotinas do cron',er.length?'<span class="s-aviso">'+er.map(function(r){return esc(r.nome)}).join(', ')+' com erro</span>':rot.length+' ok','mut')
    +usoGit(d.git)
    +linhaTx('Logados 24 h · 7 dias',n(a1.pessoas,0)+' · '+n(a7.pessoas,0)+' <span class="fraco">('+n(st.assinante,0)+' assin. · '+n(st.vencido,0)+' venc.)</span>','mut')
    +linhaTx('Visitas PRO (total)',n(p.visitas,0)+(p.visitas_dia!=null?' <span class="fraco">+'+n(p.visitas_dia,0)+' no dia</span>':''),'mut')
    +linhaTx('IA curadoria 7 dias',n(ia.consultas,0)+' consultas · '+n(ia.tokens,0)+' tokens','mut')
    +usoRodape(d)}},
 detalhe:function(d){var ar=d.areas||{},a7=d.acessos_7d||{},a1=d.acessos_24h||{},i1=d.ia_24h||{},i7=d.ia_7d||{};
  return sec('INEMA.PRO',usoNoAr(HOSTS_PRO)+usoNota(d),1)
  +sec('Rotinas do cron',tabela(['Rotina','Estado','Última vez','Última linha do log'],(d.rotinas||[]).map(function(r){return[esc(r.nome),'<span class="'+(r.estado==='ok'?'s-ok':r.estado==='erro'?'s-erro':'s-aviso')+'">'+esc(r.estado)+'</span>',quando(r.quando),'<span class="fraco">'+esc(r.ultima)+'</span>']})))
  +sec('Quem entra logado',tabela(['','24 h','7 dias'],[['Pessoas',n(a1.pessoas,0),n(a7.pessoas,0)]].concat(['assinante','vencido','nao_assinante'].map(function(k){return[k.replace('_',' '),n((a1.por_status||{})[k],0),n((a7.por_status||{})[k],0)]})))
    +tabela(['Área (7 dias)','Pessoas'],Object.keys(a7.por_area||{}).map(function(k){return[esc(k),n(a7.por_area[k],0)]})))
  +sec('Visitas por área (contador acumulado)',tabela(['Área','Visitas','Únicos','No dia'],Object.keys(ar).sort(function(a,b){return(ar[b].visitas||0)-(ar[a].visitas||0)}).map(function(k){var v=ar[k];return[esc(k),n(v.visitas,0),n(v.unicos,0),v.visitas_dia==null?'<span class="fraco">amanhã</span>':'+'+n(v.visitas_dia,0)]})))
  +sec('Uso de IA (curadoria)',tabela(['','24 h','7 dias'],[['Consultas',n(i1.consultas,0),n(i7.consultas,0)],['Tokens',n(i1.tokens,0),n(i7.tokens,0)],['Custo US$',n(i1.custo_usd,2),n(i7.custo_usd,2)]])
    +'<p class="nota">Modelos (7 dias): '+(Object.keys(i7.modelos||{}).map(function(k){return esc(k)+' ×'+i7.modelos[k]}).join(' · ')||'–')+'. Lab (arena): '+n(d.lab_total,0)+' registros. Pedidos de acervo em aberto: '+n(d.pedidos_abertos,0)+'.</p>')
  +usoGitDet(d.git)}};

G.portal={tile:function(d,g){var s=usoSem(d,g);if(s)return s;
  var v1=d.visitas_24h||{},v7=d.visitas_7d||{},c7=d.cliques_7d||{},h1=d.chat_24h||{},h7=d.chat_7d||{},ev=d.eventos_pagina||{};
  var fora=usoSites(HOSTS_PORTAL).filter(function(x){return!x.ok});
  var fr=fora.length?'<p class="frase s-erro">inema.club fora do ar</p>':'<p class="frase">'+plural(v1.visitas||0,'visita','visitas')+' em 24 h</p>';
  return{frase:fr,corpo:usoNoAr(HOSTS_PORTAL)+usoGit(d.git)
    +linhaTx('Visitas 7 dias',n(v7.visitas,0)+' <span class="fraco">('+n(v7.sessoes,0)+' sessões)</span>','mut')
    +linhaTx('Busca 7 dias',n(c7.busca,0)+' resultados · '+n(c7.busca_menu,0)+' no menu','mut')
    +linhaTx('Eventos 7 dias',n(c7.evento,0)+' cliques'+(c7.top_evento&&c7.top_evento[0]?' <span class="fraco">('+esc(c7.top_evento[0][0].slice(0,28))+')</span>':''),'mut')
    +linhaTx('Chat 24 h · 7 dias',n(h1.conversas,0)+' · '+n(h7.conversas,0)+' conversas'+(h7.erros_modelo?' <span class="s-aviso">'+h7.erros_modelo+' erros</span>':''),'mut')
    +usoRodape(d)}},
 detalhe:function(d){var v1=d.visitas_24h||{},v7=d.visitas_7d||{},c1=d.cliques_24h||{},c7=d.cliques_7d||{},h1=d.chat_24h||{},h7=d.chat_7d||{},ev=d.eventos_pagina||{};
  return sec('Portal inema.club',usoNoAr(HOSTS_PORTAL)+usoNota(d),1)
  +sec('Visitas e cliques',tabela(['','24 h','7 dias'],[['Visitas',n(v1.visitas,0),n(v7.visitas,0)],['Sessões',n(v1.sessoes,0),n(v7.sessoes,0)],['Cliques',n(c1.total,0),n(c7.total,0)]])
    +tabela(['Seção (7 dias)','Cliques'],Object.keys(c7.por_secao||{}).map(function(k){return[esc(k),n(c7.por_secao[k],0)]})))
  +sec('Busca',tabela(['','24 h','7 dias'],[['Resultado clicado (busca da home)',n(c1.busca,0),n(c7.busca,0)],['Link "Buscas" do menu (buscas.inema.club)',n(c1.busca_menu,0),n(c7.busca_menu,0)]])
    +'<p class="nota">O texto buscado não é gravado no portal; só o clique no resultado.</p>'+(c7.top_busca&&c7.top_busca.length?tabela(['Mais clicados','Cliques'],c7.top_busca.map(function(x){return[esc(x[0]),n(x[1],0)]})):''))
  +sec('Eventos',tabela(['Evento mais clicado (7 dias)','Cliques'],(c7.top_evento||[]).map(function(x){return[esc(x[0]),n(x[1],0)]}))
    +'<p class="nota">Página eventos.inema.pro (contador do inemapro): '+n(ev.visitas,0)+' visitas, '+n(ev.unicos,0)+' únicos no total.</p>')
  +sec('Chat do portal',tabela(['','24 h','7 dias'],[['Conversas',n(h1.conversas,0),n(h7.conversas,0)],['Perguntas',n(h1.perguntas,0),n(h7.perguntas,0)],['Respostas',n(h1.respostas,0),n(h7.respostas,0)],['Erros do modelo',n(h1.erros_modelo,0),n(h7.erros_modelo,0)],['Leads',n(h1.leads,0),n(h7.leads,0)],['Pedidos de construção',n(h1.pedidos,0),n(h7.pedidos,0)]])
    +'<p class="nota">Sem conversas de teste. O chat não grava tokens nem custo.</p>')
  +usoGitDet(d.git)}};
`;
