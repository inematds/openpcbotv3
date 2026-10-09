# Campanhas INEMA — onde e como preparar (Comunidade VIP + Aventura)

Criado por instrução explícita do usuário em 19/09/2026 e ampliado em 09/10/2026. Vale para qualquer pedido de mensagem, divulgação ou campanha por e-mail ou Telegram. Cópias idênticas estão em TLGruposVIP, inemaonline, wifi e openpcbotv3.

## Regra geral (vale para as duas bases)

- **Preparar ≠ enviar.** Deixar a campanha em **rascunho**, sem agendamento e com a fila vazia. Quem dispara é o usuário, pelo painel. Só disparar com autorização explícita para isso.
- **Partir da campanha anterior do mesmo canal:** ler o assunto, o texto e o HTML completo e reaproveitar o layout (tabelas 680px, banner, botões, rodapé com descadastro). Nunca reduzir o e-mail a HTML simples (foi o erro do Jev, 19/09).
- **Fontes:** só descrever o que existe de fato (conferir a página e o projeto). Os CTAs vão para **https://inema.club**. Link direto para vídeo, evento ou repo só quando o usuário pedir.
- **Prévia:** Playwright em 390px e 900px, conferindo se as imagens carregaram (`naturalWidth > 0`), se não há overflow e quais links aparecem. Sem playwright no projeto, usar `NODE_PATH=~/projetos/agent-browser/node_modules`.
- **Ler de volta do banco:** texto e HTML idênticos aos arquivos, status de rascunho, contagem real de destinatários, nada enviado.
- **Registrar** em `docs/` do projeto (relatório) e guardar os artefatos (email.html, email.txt, telegram.txt/assunto.txt, previews).
- Thumbnail de vídeo do YouTube no e-mail: `https://img.youtube.com/vi/<ID>/maxresdefault.jpg`, como imagem clicável para o vídeo.

---

## 1. Comunidade VIP — TLGruposVIP (Telegram + e-mail)

- **Projeto:** `~/projetos/TLGruposVIP` (Supabase; credenciais em `.env.local`, carregadas em runtime). Base: membros VIP/pessoas físicas, com cerca de 970 no Telegram e 4.400 no e-mail.
- **Painel:** dashboard TLGruposVIP → **Envio** → campanha → **Enviar Agora**.
- **Tabelas:** `campanhas_envio` (nome, canal, assunto, mensagem, mensagem_html, status `rascunho`, `agendado_para=null`, `intervalo_segundos`, total) + `campanha_destinatarios` (status `pendente`). **Não** inserir em `fila_envios` nem chamar `/api/envio/campanhas/[id]/enviar`.
- **Intervalos:** Telegram 30s, e-mail 2s.
- **Telegram:** o worker envia com `parse_mode: 'HTML'`, então dá para usar `<b>`, mas é preciso escapar `<`, `>` e `&` soltos. Limite de 4.096 caracteres. Destino precisa ser um chat_id numérico (não @username).
- **Lista:** copiar da última campanha do mesmo canal e cruzar com `pessoas_fisicas` atual. Excluir inativos, `nEmail=true`, bounces/bloqueios (`bounce-list|bounced|mailbox does not exist|invalid email|blocked by the user|user is deactivated|chat not found`). Deduplicar por e-mail ou chat_id.
- **"Todos no Telegram e e-mail só para quem não tem Telegram":** o e-mail exclui quem está na lista do Telegram (por pessoa e por e-mail). Em 08/10 isso tirou 939 pessoas: 967 receberam por Telegram e 3.496 por e-mail.
- **Script modelo (idempotente, só rascunho):** `scripts/preparar-gestao-agentes-20261008.js`. Copiar, trocar a pasta, o nome, o assunto e os IDs das campanhas de origem e rodar com `node`.
- **Referências:** `docs/RELATORIO_CAMPANHAS_GESTAO_AGENTES_20261008.md` (+ `docs/campanhas/gestao-agentes-2026-10-08/`), OSWork 21/09, Jev 19/09.

## 2. Aventura — inemaonline (eai.inema.club / aventura.inema.club, só e-mail)

- **Projeto:** `~/projetos/inemaonline` (Cloudflare Worker + **D1 `inemaonline`**). Base: cerca de 26 mil ex-usuários do INEMA Aventura (2000–2015), **leigos em IA**. A linguagem deve ser simples e viral ("não precisa ser programador", "grátis", "5 minutos"), com o vídeo primeiro e o conteúdo depois.
- **Painel:** https://eai.inema.club/admin/campaigns/<id> (login de admin; também funciona no host aventura). Revisar e clicar em enviar: a campanha passa para `sending` e o **cron drena até 5.000/dia** (26 mil levam uns 6 dias).
- **Tabelas D1:** `email_templates` (name único, subject, body_html, body_text) → `campaigns` (type `email`, subject, `body = json_object('template_id',…,'html',…,'text',…)`, `segment_id=7`, `segment_snapshot`, status `draft`, total) → `campaign_recipients` (contact_id, email, status `pending`).
- **Lista:** quem tem `status='sent'` na última campanha **e** `contacts.opt_in_email=1 AND unsubscribed_at IS NULL AND email<>''`. **Não** deduplicar com subquery correlacionada `lower(email)`, porque derruba o D1 por CPU (FALHAS 02/10). A base já é única.
- **Como executar:** gerar um `.sql` no scratchpad (strings com `'` duplicado) e rodar `cd worker && npx wrangler d1 execute inemaonline --remote --file=<sql>`. Conferir com `--json --command "SELECT …"`. Se aparecer erro 7403 do Cloudflare, é transitório: repetir.
- **Variáveis por contato** aceitas no corpo: `{nome}`, `{email}`, `{pagina_url}`, `{pagina_chamada}` (veja `worker/src/admin_crm.ts`).
- **Rodapé:** "Você recebe este email porque tem cadastro no INEMA Aventura… responda com 'descadastrar' ou contato@inema.club".
- **Referências:** `docs/CAMPANHA_GESTAO_AGENTES_2026-10-08.md` (#11, 26.049), `docs/CAMPANHA_ESTILOS_2026-10-02.md` (#10), `docs/CAMPANHA_OSWORK_2026-09-21.md` (#9). Artefatos em `marketing/<slug-data>/`.

---

## Entrega ao usuário

Informar o nome/ID da campanha, o link do painel, o número de destinatários, o assunto e o resumo do conteúdo, a prévia verificada e o que falta (clicar em enviar). Não é preciso deploy nem reiniciar o bot para preparar campanhas.
