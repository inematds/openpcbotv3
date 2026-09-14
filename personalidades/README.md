# Personalidades (Hermes `SOUL.md` + `/personality`)

Cada arquivo `.md` aqui é uma personalidade que o usuário liga por chat com
`/personality <nome>`. Entra no prompt DEPOIS de `IDENTIDADE.md` (a base nunca
sai) e vale tanto para resposta direta no Ollama quanto para agentes.

`/personality off` volta ao padrão. Trocar apaga a sessão retomada do chat: uma
sessão `--resume` de até 6 h carregaria a voz antiga.

Agente também pode ter `agents/<id>/SOUL.md`: persona fixa daquele agente,
somada à identidade e à personalidade do chat. Precisa de restart para o
registry de agentes reler.
