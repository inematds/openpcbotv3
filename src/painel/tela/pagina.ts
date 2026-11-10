// Página do painel: HTML + CSS + JS inline, sem build nem CDN obrigatório
// (Sora/Inter do Google Fonts com fallback de sistema).
import { PAINEL_CSS } from './estilo.js';
import { JS_AJUDA, JS_LACO } from './script-base.js';
import { JS_GRUPOS } from './script-grupos.js';

const GRUPOS = ['esperando', 'maquina', 'bots', 'producao', 'publicacao', 'creditos', 'sites', 'vagas', 'terminais'];

/** JS completo do cliente (exportado para o teste de sintaxe). */
export const PAINEL_JS = `(function(){'use strict';\n${JS_AJUDA}\n${JS_GRUPOS}\n${JS_LACO}\n})();`;

export const PAINEL_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Painel INEMA</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Sora:wght@500;600;700&display=swap" rel="stylesheet">
<style>${PAINEL_CSS}</style></head>
<body><div class="app">
<header class="topo">
  <div class="marca"><h1>Painel <i>INEMA</i></h1><span class="ver" id="ver">carregando…</span></div>
  <div class="ctl" role="group" aria-label="Como mostrar produção, publicação e terminais">
    <div class="seg"><button data-modo="lista" aria-pressed="true">Lista</button><button data-modo="icones" aria-pressed="false">Ícones</button><button data-modo="imagens" aria-pressed="false">Imagens</button></div>
    <button class="btn" id="voz" aria-pressed="false">Voz desligada</button>
  </div>
  <div class="relogio" id="hora">--:--<small id="data"></small></div>
</header>
<div class="faixa" id="faixa" role="status" aria-live="polite"><span class="calmo">Lendo o estado da máquina…</span></div>
<main class="grade">
${GRUPOS.map((g) => `  <div class="tile t-${g}" id="t-${g}" data-abrir="${g}" role="button" tabindex="0" aria-label="Abrir ${g}"></div>`).join('\n')}
</main>
</div>
<div class="folha" id="folha" role="dialog" aria-modal="true" aria-labelledby="folha-titulo">
  <div class="caixa"><div class="cabf"><h2 id="folha-titulo"></h2><button class="btn fechar" id="fechar">Fechar (Esc)</button></div>
  <div class="conteudo" id="folha-conteudo"></div></div>
</div>
<script>${PAINEL_JS}</script>
</body></html>`;
