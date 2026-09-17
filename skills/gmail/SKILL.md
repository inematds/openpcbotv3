---
name: gmail
description: Ler, buscar, marcar como lida e enviar mensagens Gmail pelas contas configuradas no openpcbotv3.
allowed-tools: Bash(python3 /home/nmaldaner/projetos/openpcbotv3/conectores/google/gmail.py *)
---

# Gmail do openpcbotv3

Execute a partir de `/home/nmaldaner/projetos/openpcbotv3` com Python 3 do sistema.
Os aliases são `inematds`, `nei2014` e `nei2024`; confirme o mapa com `contas`.
`--conta` aceita alias, aliases separados por vírgula ou `todas`.

```bash
python3 conectores/google/gmail.py contas
python3 conectores/google/gmail.py --conta todas list --limite 10
python3 conectores/google/gmail.py --conta inematds recentes --horas 48 --limite 20
python3 conectores/google/gmail.py --conta nei2014 buscar 'subject:reunião' --limite 10
python3 conectores/google/gmail.py --conta nei2014 ler <id>
python3 conectores/google/gmail.py --conta nei2014 marcar-lida <id>
python3 conectores/google/gmail.py --conta inematds enviar --para destinatario@example.com --assunto 'Assunto' --texto 'Corpo'
```

Antes de enviar, apresente remetente, destinatário, assunto e corpo e obtenha confirmação.
Saída JSON por mensagem: `conta`, `id`, `threadId`, `de`, `para`, `assunto`, `data`,
`resumo`, `nao_lida`; `ler` acrescenta `corpo`. Não há agrupamento por thread.
O CLI não implementa resposta em thread, anexos, rascunhos, filtros, gestão de labels
ou marcar como não lida. Não invente comandos nem trate `enviar` como resposta em thread.

## Configuração e OAuth

Credencial compartilhada: `~/.config/google/credentials.json`.
Contas: `~/.config/google/contas.json`, objeto JSON `{alias: email}`.
Tokens: `~/.config/google/token_gmail_<alias>.json`, permissão 600.
Projeto existente: `inema-tds-459114`; reaproveite o OAuth Desktop existente.
Não crie outro projeto/client nem exponha segredos.

```bash
python3 -u conectores/google/gmail.py --conta inematds auth
```

Mantenha o processo ativo e abra a URL na mesma máquina. Autorize uma conta por vez,
confira identidade pela API. Nunca faça probe TCP/HTTP no callback localhost.
Scopes: `gmail.readonly`, `gmail.modify`, `gmail.send`.
Consulte `docs/CONECTORES.md` para ingestão; a autorização não liga o cron sozinha.
