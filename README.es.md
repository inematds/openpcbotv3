# openpcbot v3

**🇧🇷 [Português](README.md) · 🇺🇸 [English](README.en.md) · 🇪🇸 [Español](README.es.md)**

Asistente personal multicanal (Telegram, CLI, HTTP) con cola duradera en SQLite, gestor de Ollama con preflight de RAM, costo por llamada con presupuesto, cerebro con memoria PT-BR y consolidación nocturna. Sucesor de `openpcbotv2`, funcionando **junto a** él (estrangulamiento, no corte).

Plan y arquitectura: [PLANO-MIGRACAO-V3.md](PLANO-MIGRACAO-V3.md). Estado por fase: [CHANGELOG.md](CHANGELOG.md). Fallas: [FALHAS.md](FALHAS.md).

Bot en Telegram: **@inemav3bot** (el v2 continúa en @inemaclaudebot).

**Conectar correos electrónicos, agendas y Telegram al cerebro:** [docs/CONECTORES.md](docs/CONECTORES.md).

## Jev para observar el enrutamiento

`/jev observar` activa la comparación de ruta, agente y skill mediante OpenRouter en este chat; `/jev` muestra el resultado y `/jev off` la desactiva. Desde la 3.4.4 cada comparación queda guardada: `/jev historico` lista y `/jev relatorio dia|semana` resume (se envía automáticamente en Telegram a las 8h05 y los lunes a las 8h10). El enrutador actual sigue decidiendo. Los costos pasan por el gateway y aparecen en `/usage`. [Configuración, límites y prueba real](docs/JEV.md).

Los comandos Jev también están en la ayuda del bot: envía `/help` o `/ajuda` para ver la lista y `/ajuda jev` para consultar la explicación detallada. La observación envía al proveedor el mensaje actual y los criterios de clasificación, sin memoria ni historial; las sugerencias no alteran las rutas ni ejecutan skills.

## 📖 Guía de uso

Guía completa (landing + paso a paso): **https://inematds.github.io/openpcbotv3/guia/es/**

---

## 1. Iniciar

```bash
npm install
cp .env.exemplo .env          # TELEGRAM_BOT_TOKEN_V3 = bot PROPIO, de BotFather
npm run doctor                # revisa env, Ollama, RAM, CLIs, v2, unit
npx tsx src/cli/importar.ts   # (una vez) importa memorias del v2 mediante snapshot
bash scripts/instalar-servico.sh   # unit systemd --user, MemoryMax=2G, Restart=on-failure
```

Sin token de Telegram, el servicio inicia de todas formas con HTTP (`127.0.0.1:3142`) y CLI. El token del v2 es **rechazado** (dos `getUpdates` = 409 y bot sin respuesta).

## 2. Operar

| Qué | Cómo |
|---|---|
| Health (lo consume el hub `wifi`) | `GET http://127.0.0.1:3142/health` |
| Dashboard | `http://127.0.0.1:3142/` |
| Hablar con el bot sin Telegram | `npm run cli -- "mensagem"` o `POST /mensagem {"texto":"..."}` |
| Logs | `journalctl --user -u openpcbotv3 -f -o cat` |
| Reiniciar después de cambiar `src/` o `.env` | `bash scripts/instalar-servico.sh` |
| Diagnóstico | `npm run doctor` (config) · `npm run doctor -- --deep` (pruebas reales: envía un mensaje en Telegram y ejecuta un job) |
| Detener todo ahora | `/parar tudo <motivo>` en el chat; `/retomar` libera |
| Pruebas | `npm test` (202) |

---

## 3. Cómo funciona (el recorrido de un mensaje)

```
Telegram / CLI / HTTP
   │  el adaptador traduce al BUS ("mensagem.recebida")
   ▼
ORQUESTRADOR
   ├─ ¿empieza con "/"?  → comando (sección 4), responde de inmediato
   ├─ ventana collect de 2 s: los mensajes seguidos se convierten en uno
   ├─ ENRUTADOR: llama3.2 (local, gratis) devuelve JSON {rota, agente, tier, motivo}
   │     "direto"  → conversación, pregunta breve, resumen, traducción
   │     "agente"  → necesita una herramienta: archivo, shell, repo, web, skill, calendario
   ├─ CEREBRO arma el contexto de memoria (hasta 600 tokens, sección 6)
   │
   ├─ direto → GATEWAY LLM (tier local = qwen3.8:27b residente) → respuesta
   │           guarda turno + memoria; si es un hecho duradero, propone una entrada en el vault
   │
   └─ agente → job en la COLA (lane `agente`, 1 a la vez)
               worker ejecuta `claude -p --output-format json` con un prompt por capas
               (identidad + agente + memoria + skills + mensaje)
               el resultado vuelve por el bus al chat de origen; se registra el costo real
   ▼
GUARDIA DE EXFILTRACIÓN: se revisa todo texto que sale (tokens, keys, JWT, valores de .env) → [REDACTADO]
```

Especialistas en paralelo (estándar grokky): cuando el enrutador indica `consultar`, hasta 2 agentes **solo de lectura** (p. ej., `research`) se ejecutan antes y el `lead` recibe sus resultados en el prompt. Solo el lead escribe.

---

## 4. Comandos en el chat

| Comando | Qué hace |
|---|---|
| `/status [id]` | cola por lane (en ejecución/pendiente) o detalle de un job con resultado/error |
| `/cancelar <id>` · `/prioridade <id> <n>` | opera la cola |
| `/usage` | costo de hoy/semana/mes, por tier y por agente, presupuesto |
| `/health` | Ollama (modelos cargados, latencia), RAM/swap, RSS del proceso, cola, heartbeat, canales |
| `/ollama status\|preflight <m>\|descarregar <m>` | gestor de Ollama (rechaza descargar modelos que no sean del v3) |
| `/memoria lista\|buscar <t>\|salvar <t>\|esquecer <id>\|propostas\|aprovar <id>\|descartar <id>` | cerebro y vault |
| `/tarefa add [quando] <texto>` · `/tarefa lista` · `/tarefa feita <id>` | tus tareas; `quando` = `em 2h`, `amanhã 9h`, `sex 10h`, `15/09 14:30` |
| `/daily` | resumen: tareas, completadas en las últimas 24 h, costo del día, cola, Ollama, MEMORY.md |
| `/cron lista\|on <nome>\|off <nome>` | tareas programadas |
| `/fontes` · `/fontes ingerir [gmail|agenda]` | chats observados y lo que ya se convirtió en memoria ([docs/CONECTORES.md](docs/CONECTORES.md)) |
| `/agentes` · `/skills` | lo que está instalado |
| `/novo` | limpia la sesión de CLI y el historial del chat · `/compress` solo la sesión |
| `/consolidar` | ejecuta ahora la consolidación de memoria |
| `/parar [tudo\|agentes\|<agente>] [motivo]` · `/retomar [alvo]` | interruptores persistentes; `/parar` solo muestra la lista |
| `/fila [collect\|followup\|steer\|interrupt]` | cómo tratar un mensaje que llega mientras hay otro en curso (por chat) |
| `/personality [nome\|off]` | persona de este chat (`personalidades/*.md`, se suma a `IDENTIDADE.md`) |
| `/context [detail] [texto]` | tokens por capa del prompt, directo y agente |
| `/jev [observar\|off]` | activa/desactiva la comparación en este chat; sin argumento, muestra el estado y la última sugerencia con el costo |
| `/jev historico [n]` | últimas n comparaciones (predeterminado 10, máx. 50) con concordancia acumulada |
| `/jev relatorio dia\|semana` | resumen de las últimas 24 h o 7 días: concordancia, confianza, divergencias, costo |
| `/ajuda jev` | explica la observación Jev, los datos enviados y sus límites |
| `/chatid` · `/versao` · `/ajuda` · `/help` | identificación del chat, versión y lista de comandos |

---

## 5. Cola (`src/fila/`, portada del inemaccbot)

SQLite con claim atómico (`UPDATE ... RETURNING`), lease con heartbeat cada 30 s, backoff exponencial, idempotencia por `idem_key`, cancelación sin carrera, drain ordenado en `SIGTERM` (renueva el lease mientras espera, aborta después de 110 s). Los jobs nunca se eliminan: son el historial.

Lanes y concurrencia (`src/fila/filas.ts`):

| lane | conc. | uso |
|---|---|---|
| `chat` | 2 | respuesta directa que llegó mientras otra estaba en curso |
| `agente` | 1 | `claude -p` (cada uno ~500 MB de RAM) |
| `ollama` | 1 | consolidación, embeddings |
| `cron` | 1 | tareas programadas |
| `io` | 4 | red/archivo, unión de especialistas |

Todo job con `chat_id` avisa al chat al terminar (con éxito o con error). Si el envío falla, un barrido cada 20 s vuelve a entregarlo.

---

## 6. Cerebro (`src/cerebro/`)

**Memorias** (tabla `memories`, igual a la del v2): cada mensaje tuyo de más de 20 caracteres se convierte en una memoria, clasificada por regex PT-BR + inglés en `semantic` (duradera: "meu", "prefiro", "sempre", "nunca", "lembra", "moro em", "meu nome"...) o `episodic`. Las preguntas nunca se convierten en hechos. Deduplicación por hash de la frase normalizada.

**Salience**: comienza en 1.0, +0.1 por cada uso; decae por día sin uso (semántica 0,5 %, episódica 2 %); por debajo de 0.05 y sin acceso durante 30 días, se elimina.

**Búsqueda**: FTS5 (palabra clave) + vector `bge-m3` (BLOB de 1024 floats, coseno en JS). Los vectores se indexan mediante el cron `indexar-memoria` cada 15 min.

**Contexto en el prompt** (3 capas, límite de 600 tokens): 3 por palabra clave, 3 por vector, 3 más importantes, 3 más recientes, sin repetir, más 3 insights.

**Consolidación nocturna** (cron 4h, en Ollama, costo cero): fusiona duplicados (se conserva el más reciente), detecta contradicciones por fecha (el antiguo recibe `superseded_by`, nunca se elimina) y genera hasta 3 insights por chat.

**Vault curado** (`~/vault/MEMORY.md` y `USER.md`): el bot propone, tú apruebas (`/memoria aprovar <id>`). No se escribe nada sin aprobación. `USER.md` entra en el prompt de cada conversación.

**Importación del v2**: `VACUUM INTO` crea un snapshot consistente de la base de datos del v2 (que sigue en uso) y lo inserta con `origem='v2'`. Idempotente.

**Bucle de aprendizaje de skills**: los borradores van a `skills/_rascunhos/`; nunca se promueven por sí solos.

---

## 7. Gestor de Ollama (`src/ollama/`)

Solo HTTP con el servicio systemd (nunca `ollama serve`). `config/ollama.yaml`:

| función | modelo | motivo |
|---|---|---|
| `roteador` | `llama3.2` | clasificación en JSON, 2 s, 4 GB |
| `geral` | `qwen3.8:27b`, residente | **misma etiqueta que el v2**: un único modelo sirve a ambos bots |
| `embed` | `bge-m3` | vectores de memoria, 0,7 GB |
| `pesado` | `llama3.1:70b`, **desligado** | 42 GB; solo después del corte |

**Preflight** antes de cualquier llamada local: si el modelo ya está residente, pasa; los modelos pequeños necesitan tamaño + 4 GB libres; un modelo grande no residente necesita `PISO_RAM_GB` (40) y que **no haya ningún otro modelo grande cargado**. Si falla, recurre al tier barato y envía una alerta. El v3 **nunca descarga** un modelo que no haya cargado (podría ser del v2).

**Probe** cada 60 s: `/api/ps`, latencia de un "ok" en el enrutador, RAM. Alerta si Ollama está fuera de servicio, latencia > 5 s, RAM < 10 GB, dos modelos grandes residentes.

---

## 8. Costo (`src/custo/`)

`gateway.ts` es el **único** punto por el que pasa una llamada de LLM (incluidos los embeddings). Orden: presupuesto → elige proveedor según el tier → preflight de RAM (si es local) → llama → mide latencia → calcula costo → guarda en `chamadas_llm`.

| tier | proveedor | modelo | cuándo |
|---|---|---|---|
| `local` | Ollama | qwen3.8:27b | predeterminado; costo 0 |
| `barato` | OpenRouter | claude-haiku-4.5 | razonamiento largo en una respuesta directa, o Ollama sin RAM |
| `premium` | `claude -p` (CLI) | sonnet/opus por agente | ruta de agente; el costo real proviene del propio CLI |

Presupuesto (`config/orcamento.yaml`, `ORCAMENTO_MENSAL_USD`): alerta al 70 %, **bloquea al 100 %** (solo pasa Ollama). Subir de tier registra el motivo.

---

## 9. Tareas, cron y heartbeat (`src/tarefas/`)

- **Cron** se convierte en un job de la cola con `idem_key = nome@ocorrência` (nunca se ejecuta dos veces). Sesión `isolada` (contexto limpio) o `principal`. Predeterminado: `lembretes` (1 min), `indexar-memoria` (15 min), `decaimento` (3h30), `consolidacao-noturna` (4h), `backup-noturno` (4h15), `daily-8h`.
- **Heartbeat** cada 30 min: recupera leases vencidos, cancela procesos zombi (en ejecución durante más de 2× el timeout de 20 min), alerta tras 3 fallas de la misma tarea en 1 h.
- **Tus tareas** (`tarefas_usuario`): recordatorio por fecha, resumen en `/daily`.

---

## 9b. Control de la conversación (fase 9: interruptores, modos de cola, persona, contexto)

Todo lo de esta sección queda en la tabla `prefs` (KV por chat; `'*'` es global) y sobrevive a un reinicio.

### Interruptores (`/parar`, `/retomar`)

| Objetivo | Qué bloquea | Qué continúa |
|---|---|---|
| `tudo` | cualquier respuesta (Telegram, CLI, HTTP, cron→responder) y cualquier agente | comandos con barra; mantenimiento en la lane `ollama` (consolidación, ingesta, indexación, backup) |
| `agentes` | despacho de `claude -p` (lead y especialistas) | respuesta directa en Ollama |
| `agente:<id>` | solo ese agente (`/parar ops quebrou`) | el resto |

- `/parar` sin argumentos muestra lo que está activado, con el motivo. `/retomar` sin objetivo los desactiva todos.
- Al activarlo, cancela lo que está en curso en las lanes `chat`, `agente` e `io` que coincida con el objetivo. Un `claude -p` en ejecución termina en el siguiente ciclo del worker (hasta 30 s).
- Un job encolado **antes** de `/parar` falla al ser recogido, con el motivo, sin gastar tokens.

### Modos de cola (`/fila`)

Qué hacer con un mensaje que llega mientras otro está en curso. Por chat; predeterminado `collect`.

| Modo | Comportamiento | Diferencia frente a openclaw |
|---|---|---|
| `collect` | agrupa mensajes seguidos durante 2 s y responde una vez | igual |
| `followup` | sin ventana; si está ocupado, entra en la cola y responde después | igual |
| `steer` | si está ocupado, **sustituye** lo que estaba en la cola de este chat por el nuevo, con prioridad alta | openclaw lo inyecta al agente en ejecución; con `claude -p` en un subproceso no es posible, así que el mensaje solo entra cuando termina el agente actual |
| `interrupt` | cancela la cola y los agentes de este chat (por `flow_ref = canal:chat`) y responde al nuevo ahora | una respuesta directa que ya está en curso en Ollama no se puede abortar: termina y se descarta (contador de generación por chat) |

### Persona (`/personality`, `SOUL.md`)

Tres capas, siempre sumadas, en este orden en el prompt:

1. `IDENTIDADE.md` (raíz): la base, nunca se omite.
2. `agents/<id>/SOUL.md`: persona fija de ese agente (opcional; requiere reiniciar para que el registry vuelva a leerla).
3. `personalidades/<nome>.md`: se elige por chat con `/personality <nome>`; `/personality off` vuelve al valor predeterminado. Se aplica a respuestas directas y agentes.

Cambiar la personalidad borra las sesiones `--resume` del chat; de lo contrario, el agente retomaría con la voz anterior durante hasta 6 h. Ejemplos incluidos: `curto`, `professor`. Para crear una, agrega un nuevo `.md` a la carpeta.

### `/context [detail] [texto]`

Mide, sin llamar a un modelo de chat, cuánto ocupa cada capa del prompt (identidad, persona, `USER.md`, memoria e insights, historial, skills, reglas, mensaje), para la respuesta directa y para el agente. `detail` enumera los elementos de memoria e historial. Sin `texto`, usa tu último mensaje del chat como consulta. La recuperación se ejecuta en modo de solo lectura: `/context` no aumenta la salience.

### `doctor --deep`

`npm run doctor -- --deep` agrega cuatro probes que **ponen a prueba** el sistema, marcados como probe: `GET /health` del servicio; `sendMessage` en Telegram para el `ALLOWED_CHAT_ID` (nunca `getUpdates`); una llamada al modelo `roteador` a través del gateway de costo en una base de datos en memoria (no entra en `chamadas_llm`); y un job `doctor-probe` en la lane `io` que el worker del servicio debe recoger y completar en 30 s (falla con "servicio antiguo" si el binario en ejecución no tiene la tarea: reinstala).

### MCP por agente (`mcp_config`)

En `agents/<id>/agent.yaml`, `mcp_config: mcp.json` (ruta relativa a la carpeta) hace que `claude -p` se inicie con `--mcp-config <arquivo> --strict-mcp-config`: el agente ve **solo** esos servidores. Sin la clave, hereda los MCP de `~/.claude` como siempre. Modelo en `agents/_template/mcp.json.example`. Un cliente MCP nativo en la ruta de Ollama está anotado como fase 10 en [docs/INCORPORAR-V3.md](docs/INCORPORAR-V3.md), sin fecha de inicio.

---

## 10. Canales (`src/canais/`)

- **Telegram** (grammy): solo el `ALLOWED_CHAT_ID`; el markdown simple se convierte a HTML; los mensajes largos se dividen; 409 se registra en el log, no genera un bucle.
- **CLI**: stdin/stdout cuando hay TTY o `--cli`.
- **HTTP**: `127.0.0.1` de forma predeterminada (`POST /mensagem` ejecuta un agente con permisos). Exponer en la LAN solo con `HTTP_BIND_V3=0.0.0.0` **y** `DASHBOARD_TOKEN_V3`.
- **Slack**: Web API mediante fetch, prueba de OAuth en doctor; desactivado hasta el corte (el token es del v2).
- **WhatsApp**: stub que rechaza solicitudes mientras el v2 está activo (sesión única del número; whatsapp-web.js inicia un Chromium). Implementación real en la fase 8, en un daemon separado.

---

## 11. Telemetría y alertas

Logs JSON de pino en el journal. `GET /health` devuelve `ok` (Ollama en línea, RAM ≥ 10 GB, heartbeat < 90 min), además de cola, modelos, RAM y presupuesto. Alertas con deduplicación de 30 min por clave, entregadas en el chat permitido de Telegram: Ollama fuera de servicio, poca RAM, lease muerto, proceso zombi, 3 fallas, presupuesto 70 %/100 %.

Dashboard (`/`): health, Ollama/RAM, cola por lane, costo de 14 días (sparkline) y por tier/agente, memoria, jobs recientes. Se actualiza cada 10 s.

Backup nocturno: `VACUUM INTO` + `age` (si `AGE_RECIPIENT`) o gzip, retención de 14, en `store/backups/`.

---

## 12. Garantías de memoria en la coexistencia con el v2

- **Las mismas etiquetas del v2**: un modelo residente para ambos bots. Cambiar la etiqueta de `geral` sin cambiarla en el v2 = dos modelos grandes = OOM.
- **Preflight de RAM** y política de 1 modelo grande residente; nunca descarga modelos ajenos; 70b desactivado.
- **Unit con `MemoryHigh=1.5G` / `MemoryMax=2G`** (cgroup v2 delegado, verificado) y `--max-old-space-size=1024`. Pico observado: ~1 GB con un `claude -p`.
- Lane `agente` con concurrencia 1. WhatsApp/Slack desactivados.
- El `keep_alive: -1` del modelo general fija 17 GB en la RAM (la máquina pasó de 57 a 35 GB libres). Es el diseño del plan; para liberar, cambia a `10m` en `config/ollama.yaml`.

---

## 13. Configuración

`.env` del v3 (solo lo específico; las keys compartidas se cargan en runtime desde el `.env` del v2):

| variable | predeterminado | |
|---|---|---|
| `TELEGRAM_BOT_TOKEN_V3` | | token propio; el del v2 es rechazado |
| `PORT_V3` | 3142 | |
| `HTTP_BIND_V3` | 127.0.0.1 | |
| `DASHBOARD_TOKEN_V3` | | protege `/` y `/api/*` |
| `PISO_RAM_GB` | 40 | GB libres para cargar un modelo grande |
| `ORCAMENTO_MENSAL_USD` | 50 | |
| `SLACK_ENABLED` / `WHATSAPP_ENABLED` | 0 | |
| `AGE_RECIPIENT` | | backup cifrado |
| (tabla `prefs`) | | interruptores, modo de cola y personalidad por chat; `/parar`, `/fila`, `/personality` escriben aquí |
| `CLAUDE_BIN` / `CODEX_BIN` | claude / codex | |

YAML en `config/`: `ollama.yaml` (funciones, límite, probe), `precos.yaml` (USD/1M tokens, tiers), `orcamento.yaml`.

---

## 14. Estructura

```
src/
  bus/           bus de eventos tipado
  canais/        telegram · cli · http(+dashboard) · slack · whatsapp(stub) · guardia de exfiltración
  fila/          store/worker/runner portados del inemaccbot (lanes: chat, agente, ollama, cron, io)
  orquestrador/  orquestador · enrutador · comandos · agente-cli · skills · agentes · tareas-fila
  ollama/        gestor (registry, preflight, probe) · cliente HTTP · ram
  custo/         gateway (único punto de LLM) · registro · presupuesto · precios
  provedores/    ollama · openrouter · anthropic
  cerebro/       memoria (FTS5+vector) · contexto (3 capas) · consolidacion · vault · importar-v2
  tarefas/       cron · heartbeat · usuario · padrao
  telemetria/    logger pino · alertas con deduplicación
  dashboard/     html
  cli/           doctor · importar · chat
  db/            abrir · migrations (con checksum) · backup
config/          ollama.yaml · precos.yaml · orcamento.yaml
systemd/         openpcbotv3.service
skills/, agents/ copiados del v2 tal como están (skills/_rascunhos = bucle de aprendizaje)
IDENTIDADE.md    persona y límites del bot (entra en cada prompt)
```

Reglas: ningún módulo supera las 500 líneas; todas las llamadas de LLM pasan por `custo/gateway.ts`; Ollama solo mediante HTTP; todo error real se convierte en una línea en `FALHAS.md`.

## 15. Lo que aún falta

- **Fase 8 (corte)**: cambiar el token de producción, v2 en solo lectura durante 30 días, archivar. Solo con una orden explícita.
- **Fase 10 (anotada)**: cliente MCP nativo en la ruta de Ollama, servidor MCP de inemavox, voz en Telegram ([docs/VOZ-TELEGRAM.md](docs/VOZ-TELEGRAM.md) — hoy solo la tiene el v2), `/retry` `/undo`, pie de uso, estado de skills ([docs/INCORPORAR-V3.md](docs/INCORPORAR-V3.md)).
- WhatsApp real (daemon separado), Slack activado.
- `steer` no se inyecta al agente en ejecución (ver 9b).
- Retención de la tabla `jobs` (hoy nunca se purga; ~1,5 k líneas/día con el cron de recordatorios).
- La memoria guarda la frase entera, no un hecho extraído.
