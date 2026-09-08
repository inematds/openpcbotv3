# Conectores — vários e-mails, várias agendas e o Telegram inteiro no cérebro

Como ligar o openpcbot v3 nas suas fontes de informação e fazer o que aparece nelas
virar **memória** (fatos curtos e buscáveis), não só resposta de momento.

Três coisas diferentes, que este documento separa de propósito:

| | O que é | Como se liga |
|---|---|---|
| **Acesso** | o bot consegue LER a fonte quando você pede | token OAuth por conta (Google) ou o próprio bot (Telegram) |
| **Observação** | o bot vê o que passa, sem responder | lista de chats observados |
| **Ingestão** | o que passou vira fato na memória | cron que lê o novo e extrai fatos no Ollama (custo zero) |

Acesso sem ingestão = o bot lê seu e-mail quando você manda, e esquece depois.
É assim que o v2 funcionava.

---

## 0. Estado hoje (confira antes de começar)

```bash
cd ~/projetos/openpcbotv3 && npm run doctor
```

O `doctor` mostra uma linha por conta e por token. Em 2026-09-07, numa máquina limpa:

- **Gmail: não conectado.** Não existe `~/.config/google/` nem credencial.
- **Calendar: script existe, sem credencial e sem token.** O `gcal.py` do v2 tinha três contas no código, mas nunca teve o `credentials.json` nesta máquina.
- **Telegram: conectado** (@inemav3bot), respondendo só no seu chat pessoal.

Os conectores agora moram **no repo**, em `conectores/google/`, e não em `~/.config`:

```
conectores/google/
  comum.py      config + OAuth compartilhados (1 credencial serve todas as contas)
  gmail.py      CLI multi-conta do Gmail
  gcal.py       CLI multi-conta do Calendar
  contas.exemplo.json
```

Segredos e tokens **nunca** entram no repo: ficam em `~/.config/google/`.

---

## 1. Vários e-mails (Gmail)

Uma credencial OAuth (o "app") serve **todas** as contas. Cada conta tem seu token.
Adicionar a quarta conta depois custa um comando.

### 1.1 Criar a credencial, uma vez

1. Abra <https://console.cloud.google.com> e crie um projeto (ex.: `openpcbot`).
2. **APIs & Services → Library**: ative **Gmail API** e **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**: tipo **External**, preencha nome e e-mail de suporte.
   Em **Test users**, adicione **todos os e-mails** que você vai conectar. Sem isso, o login falha
   com `access_denied`. Não precisa publicar o app; em modo *Testing* o token de teste expira
   em 7 dias, então **publique** (botão *Publish app*) quando confirmar que funciona.
4. **Credentials → Create credentials → OAuth client ID → Desktop app**. Baixe o JSON.
5. Salve como a credencial compartilhada:

```bash
mkdir -p ~/.config/google && chmod 700 ~/.config/google
mv ~/Downloads/client_secret_*.json ~/.config/google/credentials.json
chmod 600 ~/.config/google/credentials.json
```

### 1.2 Declarar as contas

Um arquivo, um alias por conta. O alias é como você chama a conta nos comandos.

```bash
cat > ~/.config/google/contas.json <<'JSON'
{
  "pessoal":  "voce@gmail.com",
  "inema":    "contato@inema.club",
  "trabalho": "voce@empresa.com"
}
JSON
chmod 600 ~/.config/google/contas.json
```

A primeira do arquivo é a padrão. Para fixar outra: `GOOGLE_CONTA_PADRAO=inema` no `.env` do v3.

### 1.3 Autenticar cada conta

Uma vez por conta. O comando imprime uma URL: abra no navegador **logado naquela conta**.

```bash
cd ~/projetos/openpcbotv3/conectores/google
python3 gmail.py --conta pessoal  auth
python3 gmail.py --conta inema    auth
python3 gmail.py --conta trabalho auth
```

Gera `~/.config/google/token_gmail_<alias>.json`. O token se renova sozinho enquanto o
`refresh_token` valer; quando não valer, o `doctor` acusa e você repete o `auth`.

### 1.4 Usar

`--conta` aceita um alias, vários separados por vírgula, ou `todas`.

```bash
python3 gmail.py --conta todas    list --nao-lidas          # caixa de entrada das 3
python3 gmail.py --conta todas    recentes --horas 6        # o que chegou (é o que a ingestão lê)
python3 gmail.py --conta pessoal  buscar "fatura vencimento"
python3 gmail.py --conta inema    ler <id>                  # corpo da mensagem
python3 gmail.py --conta inema    enviar --para a@b.com --assunto "Oi" --texto "..."
python3 gmail.py contas                                     # o que está configurado
```

Saída sempre em JSON. Uma conta com token quebrado gera aviso no stderr e **não** derruba as outras.

### 1.5 Ligar a ingestão (o que faz virar memória)

O cron `gmail-ingestao` já existe, **desligado**. Ligue depois de autenticar:

```
/cron on gmail-ingestao
```

A cada 2 horas ele lê o que chegou nas últimas 3 h em todas as contas, extrai fatos duráveis
no Ollama e grava como memória com `origem = gmail:<alias>`. Rodar agora, sem esperar o cron:
`/fontes ingerir` (esse roda a ingestão do Telegram; para o Gmail, `/cron on` e aguarde o tick,
ou enfileire pelo dashboard).

---

## 2. Várias agendas (Google Calendar)

Mesma credencial, mesmo `contas.json`. Só o consentimento é separado, porque o escopo é outro.

```bash
cd ~/projetos/openpcbotv3/conectores/google
python3 gcal.py --conta pessoal  auth
python3 gcal.py --conta inema    auth
python3 gcal.py --conta trabalho auth
```

Uso:

```bash
python3 gcal.py list --all --days 14          # agrega TODAS as agendas, ordenado por hora
python3 gcal.py --conta inema list --days 7
python3 gcal.py --conta inema create --title "Call com Paulo" --date 2026-09-10 --time 14:00 --duration 45 --meet
python3 gcal.py --conta pessoal freebusy --date 2026-09-10
```

Ingestão: `/cron on agenda-ingestao` (todo dia às 7h05, próximos 14 dias, `origem = gcal:<alias>`).

**Agendas compartilhadas** (a agenda de outra pessoa, ou uma agenda de equipe) entram sozinhas:
o token da conta enxerga tudo que aquela conta enxerga no Google Calendar. Não precisa de alias novo.

---

## 3. Todas as conversas do Telegram no cérebro

### 3.1 O que um bot consegue ver, e o que não consegue

Isto define o resto. A **Bot API** do Telegram tem limites duros:

| Consegue | Não consegue |
|---|---|
| ler mensagens de chats onde **o bot está** | ler suas conversas privadas com outras pessoas |
| ler **todo** o texto de um grupo, se a privacidade estiver desligada | ler histórico anterior à entrada do bot |
| ler legendas de foto e vídeo | listar seus contatos |
| receber mensagens encaminhadas para ele | ler canais em que o bot não é membro |

Ou seja: **o bot vê o que acontece na frente dele, dali para frente.** Não existe "importar meu
Telegram". Para as suas DMs com terceiros e o histórico, o caminho é outro (seção 3.6).

### 3.2 Desligar a privacidade do bot (obrigatório para grupos)

Por padrão, um bot em grupo só recebe mensagens que começam com `/` ou que o mencionam.
Sem mudar isso, observar grupo não funciona.

No **@BotFather**:

```
/mybots → @inemav3bot → Bot Settings → Group Privacy → Turn off
```

Depois **remova e adicione o bot de volta** em cada grupo. A configuração só vale a partir
da (re)entrada; grupos onde ele já estava continuam com o modo antigo.

### 3.3 Descobrir o id de cada chat

Adicione o bot ao grupo, mande uma mensagem qualquer lá e olhe o log:

```bash
journalctl --user -u openpcbotv3 -f -o cat | grep -i telegram
```

Ou, no chat, mande `/chatid` (funciona nos chats onde o bot responde). Grupo tem id negativo
(`-1001234567890`); conversa pessoal tem id positivo.

### 3.4 Configurar quem o bot responde e quem ele só observa

No `~/projetos/openpcbotv3/.env`:

```bash
# Chats onde ele CONVERSA (responde). Default: só o ALLOWED_CHAT_ID.
TELEGRAM_CHATS_RESPONDER=123456789

# Chats que ele só OBSERVA: grava no cérebro e NUNCA responde.
# Aceita lista, ou `todos` para qualquer chat em que o bot for adicionado.
TELEGRAM_CHATS_OBSERVAR=-1001234567890,-1009876543210
```

Aplicar: `bash scripts/instalar-servico.sh`.

Regras, na ordem: um chat listado nos dois é **de conversa**; `todos` em `OBSERVAR` pega qualquer
chat não listado; chat fora das duas listas é **ignorado** (nem grava). Com as duas listas vazias,
o bot responde a quem falar com ele, que é o estado de um bot recém-criado.

Confirme com `/fontes`.

### 3.5 O que acontece com uma mensagem observada

1. Entra no `conversation_log` com `agent_id = 'observado'`, o autor no início do texto
   (`paulo: fecho a proposta até sexta`) e o nome do grupo junto.
2. **Nenhuma resposta, nenhum LLM, nenhum custo** nesse momento. Um grupo movimentado não
   dispara nada.
3. A cada 30 min o cron `ingestao-observados` pega o que chegou desde a última passagem,
   monta **um bloco por grupo** e faz **uma** chamada no Ollama residente pedindo os fatos
   duráveis: decisão, compromisso, prazo, preferência, dado de pessoa, valor combinado.
4. Cada fato vira memória com `origem = telegram:<chatId>`, entra no FTS5, ganha vetor
   `bge-m3` no próximo ciclo e passa a aparecer no contexto das suas conversas.
5. A consolidação das 4h funde duplicatas e marca contradições (a mais nova vence).

O marcador por fonte (`ingestao_estado`) garante que rodar duas vezes não reprocessa.
Se o Ollama estiver fora, o bloco **não** é marcado e volta na próxima passagem.

Ver e forçar:

```
/fontes            # chats observados + quanto já virou memória, por fonte
/fontes ingerir    # roda a ingestão agora
/memoria buscar prazo
```

### 3.6 Se você quer MESMO todas as suas conversas (inclusive DMs e histórico)

Aí não é bot: é uma **sessão de usuário** (MTProto, via Telethon), que age como o seu próprio
aplicativo. Ela enxerga tudo que você enxerga, inclusive contatos e histórico completo.

O que isso implica, para você decidir com o dado na mão:

- Precisa de `api_id`/`api_hash` em <https://my.telegram.org> e de login com **seu telefone + código SMS**.
- O arquivo de sessão gerado **é** o acesso à sua conta. Quem o copiar entra no seu Telegram.
  Vale como uma senha, e sem 2FA nem dá aviso.
- É uma conta de usuário automatizada. O Telegram tolera uso pessoal, mas volume alto de leitura
  ou envio pode levar a limitação ou banimento da **sua conta**, não de um bot descartável.
- Não está implementado no v3 e o Telethon não está instalado nesta máquina.

**Não vou ligar isso sem você pedir explicitamente.** Se pedir, o desenho seria: processo separado,
só leitura, uma lista branca de chats, sessão em arquivo com permissão 600, e o mesmo caminho de
ingestão desta seção. O ganho real é o histórico e as DMs; para grupos, o bot da seção 3.4
resolve com muito menos risco.

---

## 4. O caminho completo, das fontes até a resposta

```
Gmail (N contas) ─┐
Calendar (N contas)─┤ conectores/google/*.py  → JSON
Telegram observado ─┘                            │
                                                 ▼
                                          INGESTÃO (lote, Ollama, custo 0)
                                       "extraia só os fatos duráveis"
                                                 │
                                                 ▼
                                    memories (origem = fonte, FTS5 + vetor)
                                                 │
                                    consolidação 4h: duplicatas, contradições
                                                 │
                                                 ▼
                       contexto de 3 camadas em TODA conversa sua com o bot
```

Verificar de ponta a ponta:

```
/fontes                    # o que está sendo observado e ingerido
/memoria lista             # os fatos mais recentes
/memoria buscar <termo>
/usage                     # a ingestão aparece como agente `ingestao`, tier local, US$ 0
```

---

## 5. Privacidade e limites (leia antes de ligar tudo)

- **Grupo observado é conversa de outras pessoas.** Elas não sabem que um bot está guardando
  fatos. Em grupo de trabalho isso costuma ser aceitável; em grupo de família ou de terceiros,
  pergunte. A escolha é sua, o aviso é meu.
- **Nada sai da máquina.** A extração roda no Ollama local, custo zero. Nenhum texto de e-mail ou
  de grupo vai para a nuvem, a menos que você mande o bot fazer algo que exija um agente (rota
  `agente`, que usa o `claude -p`).
- **A guarda de exfiltração** varre toda resposta antes de enviar: token, chave de API, JWT e os
  valores das variáveis sensíveis do `.env` viram `[REDIGIDO]`.
- **Escopos do Google**: o Gmail está com `readonly + modify + send` (para poder marcar como lida
  e responder). Se quiser só leitura, tire `gmail.send` e `gmail.modify` de `SCOPES_GMAIL` em
  `conectores/google/comum.py` e refaça o `auth` de cada conta.
- **Apagar**: `/memoria esquecer <id>` remove um fato. Para desfazer uma fonte inteira,
  `DELETE FROM memories WHERE origem = 'telegram:-100…'` no banco, com o serviço parado.

---

## 6. Quando der errado

| Sintoma | Causa provável | Correção |
|---|---|---|
| `contas.json não existe` | passo 1.2 pulado | crie o arquivo, `chmod 600` |
| `access_denied` no login | e-mail não está em *Test users* | adicione no OAuth consent screen |
| Token morre a cada 7 dias | app em modo *Testing* | *Publish app* no consent screen |
| `conta X não autenticada` | falta o `auth` daquele alias | `python3 gmail.py --conta X auth` |
| Bot não vê nada no grupo | privacidade ligada | BotFather → Group Privacy → Turn off, e **readicione** o bot |
| `/fontes` sem nenhuma fonte | ninguém falou nos chats observados ainda | mande 3+ mensagens e espere o tick |
| Ingestão sempre `0 fato(s)` | conversa sem nada durável | é o esperado; teste com "decidimos entregar dia 12" |
| `ingestao` com erro no `/status` | Ollama fora ou sem RAM | `/health`, `/ollama status` |

Falhas reais viram uma linha em [`FALHAS.md`](../FALHAS.md).
