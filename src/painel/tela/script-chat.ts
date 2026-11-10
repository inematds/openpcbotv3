// Gaveta "Conversar" do painel clássico (10/11/2026, EM TESTE): falar com o bot (PAINEL_CHAT=1) ou com uma
// sessão do Claude aberta no tmux do painel (PAINEL_ASSUMIR=1), e abrir um terminal novo numa pasta de ~/projetos.
// Mesmo cuidado do resto da tela: String.raw, sem crase nem "${" dentro do JS.
export const CHAT_HTML = `<aside class="chat" id="chat" hidden aria-label="Conversar">
  <div class="chatcab"><b>Conversar</b><select id="chat-alvo" aria-label="Com quem"></select>
    <button class="btn" id="chat-novo" title="Abre uma sessão nova do Claude numa pasta de ~/projetos">+ Novo terminal</button>
    <button class="btn" id="chat-fechar">Fechar</button></div>
  <div class="chatmsgs" id="chat-msgs"></div>
  <div class="chatteclas" id="chat-teclas" hidden><button class="btn" data-ctecla="Escape">Esc</button><button class="btn" data-ctecla="C-c">Ctrl+C</button><button class="btn" data-ctecla="Up">↑</button><button class="btn" data-ctecla="Down">↓</button><button class="btn" data-ctecla="Enter">Enter</button></div>
  <div class="chatin"><textarea id="chat-texto" rows="2" placeholder="Escreva e Enter para enviar (Shift+Enter quebra a linha)"></textarea><button class="btn quente" id="chat-enviar">Enviar</button></div>
  <div class="fraco chatst" id="chat-st"></div>
</aside>`;

export const JS_CHAT = String.raw`
var CH={alvo:'bot',ult:0,timer:null,ligado:null};
function chatSessoes(){var g=E.dados&&E.dados.grupos&&E.dados.grupos.terminais,v=g&&g.dados&&g.dados.vivos||[];return v.filter(function(t){return t.tmux})}
function chatOpcoes(){var s=document.getElementById('chat-alvo');if(!s)return;var atual=CH.alvo,h='<option value="bot">🤖 Bot (v3)</option>';
  chatSessoes().forEach(function(t){var r=t.retrato||{};h+='<option value="'+esc(t.session_id)+'">🖥 '+esc(termProj(t))+(r.nome?' · '+esc(r.nome):'')+'</option>'});
  s.innerHTML=h;s.value=atual;if(s.value!==atual){CH.alvo='bot';s.value='bot'}}
function chatSt(t){var e=document.getElementById('chat-st');if(e)e.textContent=t||''}
function chatBolha(m){return'<div class="cb '+(m.quem==='voce'?'cbv':'cbb')+'"><span class="fraco">'+(m.quem==='voce'?'você':'bot')+' · '+hm(m.quando)+'</span><p>'+esc(m.texto)+'</p></div>'}
async function chatLer(){var box=document.getElementById('chat-msgs');if(!box)return;
  try{if(CH.alvo==='bot'){var r=await fetch('/api/painel/chat?desde='+CH.ult,{headers:hdr(),cache:'no-store'}),j=await r.json();CH.ligado=!!j.ligado;
      if(!j.ligado){chatSt('conversa com o bot desligada no servidor (PAINEL_CHAT=1 liga)')}else if(!CH.ult&&!j.msgs.length){box.innerHTML='<p class="sem">Nada ainda. O que você escrever aqui entra no bot como uma mensagem do Telegram e a resposta aparece aqui.</p>'}
      if(j.msgs&&j.msgs.length){if(!CH.ult)box.innerHTML='';box.insertAdjacentHTML('beforeend',j.msgs.map(chatBolha).join(''));CH.ult=j.msgs[j.msgs.length-1].n;box.scrollTop=box.scrollHeight}}
    else{var r2=await fetch('/api/painel/terminal/tela?id='+encodeURIComponent(CH.alvo),{headers:hdr(),cache:'no-store'}),j2=await r2.json();
      box.innerHTML='<pre class="chattela">'+esc(r2.ok?j2.tela:(j2.erro||('HTTP '+r2.status)))+'</pre>';box.scrollTop=box.scrollHeight}}catch(e){chatSt('falha ao ler: '+e.message)}}
function chatTrocar(v){CH.alvo=v;CH.ult=0;var b=document.getElementById('chat-msgs');if(b)b.innerHTML='';var k=document.getElementById('chat-teclas');if(k)k.hidden=v==='bot';chatSt(v==='bot'?'':'tela ao vivo da sessão (atualiza a cada 2 s); o que você enviar é digitado nela');chatParar();chatLer();CH.timer=setInterval(chatLer,v==='bot'?3000:2000)}
function chatParar(){if(CH.timer){clearInterval(CH.timer);CH.timer=null}}
function chatAbrir(){var c=document.getElementById('chat');if(!c)return;c.hidden=false;chatOpcoes();chatTrocar(CH.alvo);var t=document.getElementById('chat-texto');if(t)t.focus()}
function chatFechar(){var c=document.getElementById('chat');if(c)c.hidden=true;chatParar()}
async function chatPost(url,corpo){var r=await fetch(url,{method:'POST',headers:Object.assign({'Content-Type':'application/json','X-Painel':'1'},hdr()),body:JSON.stringify(corpo)});var j={};try{j=await r.json()}catch(e){}return{ok:r.ok,status:r.status,j:j}}
async function chatEnviar(corpo){chatSt('enviando…');try{var r=CH.alvo==='bot'?await chatPost('/api/painel/chat',corpo):await chatPost('/api/painel/terminal/enviar',Object.assign({id:CH.alvo},corpo));
  chatSt(r.ok?'enviado às '+new Date().toLocaleTimeString('pt-BR'):(r.j.erro||('HTTP '+r.status)));setTimeout(chatLer,600)}catch(e){chatSt('falhou: '+e.message)}}
async function chatNovo(){var p=window.prompt('Pasta dentro de ~/projetos onde abrir o Claude (ex.: wifi):','wifi');if(!p)return;chatSt('abrindo…');
  try{var r=await chatPost('/api/painel/terminal/novo',{pasta:p});chatSt(r.ok?('aberto: '+r.j.nome+' — '+r.j.aviso):(r.j.erro||('HTTP '+r.status)))}catch(e){chatSt('falhou: '+e.message)}}
if(typeof document!=='undefined'){
  document.addEventListener('click',function(ev){var t=ev.target.closest('#conversar,#chat-fechar,#chat-enviar,#chat-novo,[data-ctecla]');if(!t)return;
    if(t.id==='conversar'){var c=document.getElementById('chat');if(c&&!c.hidden)chatFechar();else chatAbrir();return}
    if(t.id==='chat-fechar'){chatFechar();return}
    if(t.id==='chat-novo'){chatNovo();return}
    if(t.dataset.ctecla){chatEnviar({tecla:t.dataset.ctecla});return}
    if(t.id==='chat-enviar'){var x=document.getElementById('chat-texto');if(x&&x.value.trim()){chatEnviar({texto:x.value});x.value='';x.focus()}}});
  document.addEventListener('change',function(ev){if(ev.target&&ev.target.id==='chat-alvo')chatTrocar(ev.target.value)});
  document.addEventListener('keydown',function(ev){if(ev.target&&ev.target.id==='chat-texto'&&ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();var x=ev.target;if(x.value.trim()){chatEnviar({texto:x.value});x.value=''}}});
}
`;
