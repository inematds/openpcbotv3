# Voz no Telegram — mandar e receber áudio

Data: 25/09/2026. Item **A1** de [INCORPORAR-V3.md](INCORPORAR-V3.md) (Fase 10).

## Resumo

| | Receber voz (você fala → texto) | Responder com voz (texto → áudio) | Situação |
|---|---|---|---|
| **openpcbotv2** (produção) | ✅ Groq Whisper `whisper-large-v3` | ✅ ElevenLabs → Gradium → `say` do macOS | **Funciona hoje** |
| **openpcbotv3** (porta 3142) | ❌ nota de voz é ignorada | ❌ | Planejado (A1, Fase 10) |

**Para usar voz hoje, fale com o bot do v2.** O v3 só entende texto e legenda de foto ou vídeo. Uma nota de voz mandada ao bot do v3 cai no `return` de `src/canais/telegram.ts`, porque não tem `text` nem `caption`, e é descartada sem resposta.

---

## 1. Como usar hoje (openpcbotv2)

### Mandar voz

1. No chat do bot do v2, segure o microfone e grave (a nota de voz normal do Telegram).
2. O bot baixa o arquivo (`getFile`), renomeia `.oga` para `.ogg` e transcreve pelo Groq (`whisper-large-v3`).
3. O texto entra no fluxo normal como `[Voice transcribed]: …`: mesmo roteamento, mesma memória, mesmos agentes de uma mensagem digitada.
4. **Como você mandou voz, a resposta também vem em voz** (`forceVoiceReply`), além do texto.

### Receber voz nas mensagens de texto

- `/voice` liga e desliga o "modo voz" do chat. Ligado, **toda** resposta, mesmo a mensagens digitadas, vem também como nota de voz.
- O estado fica em memória (`voiceEnabledChats`) e **volta a desligado quando o serviço reinicia**.

### O que precisa estar configurado (`~/projetos/openpcbotv2/.env`)

| Variável | Para quê | Situação atual |
|---|---|---|
| `GROQ_API_KEY` | Transcrever (STT) | Presente |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` | Voz da resposta (1ª opção, modelo `eleven_turbo_v2_5`) | Presente |
| `GRADIUM_API_KEY` (+ voz) | Voz da resposta (2ª opção, saída opus) | Opcional |
| `ffmpeg` no PATH | Converter para OGG/Opus | Presente (`/usr/bin/ffmpeg`) |

Sem `GROQ_API_KEY`, o bot responde "Voice transcription not configured". Sem nenhum TTS, `/voice` avisa que não há voz disponível.

### Limites conhecidos do v2

- A última opção de TTS é o `say` do **macOS**, que não existe neste Linux. Se o ElevenLabs e o Gradium falharem, a resposta sai **só em texto**.
- A voz é gerada a partir da **resposta inteira**. Uma resposta longa vira um áudio longo e gasta crédito do ElevenLabs.
- O modo `/voice` não sobrevive a um reinício.
- Custos: Groq e ElevenLabs cobram por uso e **não passam** por um gateway de custo (o v2 não tem).

Código de referência: `openpcbotv2/src/voice.ts` (STT/TTS, 388 linhas) e `openpcbotv2/src/bot.ts` (`bot.on('message:voice')`, `/voice`, `replyWithVoice`).

---

## 2. Como ativar no openpcbotv3 (plano do A1)

Objetivo: o mesmo uso do v2, mandar voz e receber voz, respeitando as regras do v3. Módulos com menos de 500 linhas, o canal só traduz do e para o bus, trabalho pesado vai na fila `io`, e o provedor local vem antes do pago.

### 2.1 Fluxo

```
Telegram ── nota de voz ──► canais/telegram.ts
                              │ baixa (getFile) → store/voz/in/<id>.ogg
                              │ enfileira job 'voz.transcrever' na fila 'io'
                              ▼
                        voz/stt.ts  ─► inemavox :8010 (Whisper/Parakeet, local)
                              │          └─ fallback: Groq whisper-large-v3-turbo
                              ▼
                   bus.emit('mensagem.recebida', {texto, origemVoz: true, …})
                              ▼
                     orquestrador (igual a texto)
                              ▼
                   bus.emit('mensagem.enviar', {texto, voz: true|false, …})
                              ▼
                        canais/telegram.ts ─► sendMessage (texto, sempre)
                              │ se voz: job 'voz.falar' na fila 'io'
                              ▼
                        voz/tts.ts ─► inemavox /api/jobs/tts (chatterbox, rachel)
                              │          └─ fallback: ElevenLabs
                              ▼
                     ffmpeg → OGG/Opus 48 kHz mono → sendVoice (reply ao texto)
```

### 2.2 Arquivos novos e mudanças

| Arquivo | Conteúdo |
|---|---|
| `src/voz/stt.ts` | `transcrever(arquivo): Promise<{texto, provedor, ms}>`. Tenta o inemavox; se ele não responder em 3 s ou a GPU estiver ocupada, vai para o Groq |
| `src/voz/tts.ts` | `falar(texto): Promise<Buffer /* ogg opus */>`. Usa o inemavox e, se falhar, o ElevenLabs; converte com o ffmpeg |
| `src/voz/limpar.ts` | Texto → fala: tira markdown, `[1]`, URLs e emojis; escreve valores por extenso ("R$ 1.500" → "mil e quinhentos reais"); corta em ~400 caracteres, começando pelo principal |
| `src/canais/telegram.ts` | `bot.on('message:voice')` e `message:audio`; `sendVoice` quando `mensagem.enviar` traz `voz: true` |
| `src/bus/bus.ts` | `MensagemRecebida.origemVoz?: boolean`; `MensagemEnviar.voz?: boolean` |
| `src/db` | Tabela `chat_prefs(chat_id, voz TEXT)`, com `voz` ∈ `off \| espelho \| sempre`. Diferente do v2, **sobrevive a reinícios** |
| comando `/voz` | `/voz` (mostra), `/voz sempre`, `/voz espelho`, `/voz off` |

Modos de `/voz`:
- `espelho` (padrão): responde em voz só quando você mandou voz. É o comportamento do v2.
- `sempre`: toda resposta vem também em áudio.
- `off`: nunca responde em áudio, mas continua **entendendo** a voz recebida.

### 2.3 inemavox (local, sem custo) — chamadas usadas

```text
# transcrever (upload do .ogg recebido)
POST http://localhost:8010/api/jobs/transcribe/upload   multipart: file=<ogg>, config_json={"whisper_model":"large-v3"}
GET  /api/jobs/<id>                → status queued|running|completed|failed
GET  /api/jobs/<id>/transcript     → texto

# falar
POST http://localhost:8010/api/jobs/tts                 {"text":"…","engine":"chatterbox","voice":"rachel","lang":"pt"}
GET  /api/jobs/<id>                → aguarda completed
GET  /api/jobs/<id>/audio          → generated.wav|mp3|ogg
```

Sem `engine`, a API do inemavox usa `edge`. A regra global pede **`chatterbox` com a voz `rachel`**, então o campo precisa ir explícito. O nome exato do campo do modelo Whisper em `config_json` deve ser conferido no `api/job_manager.py` antes de implementar.

### 2.4 Variáveis (`~/projetos/openpcbotv3/.env`)

Hoje o `.env` do v3 **não tem** nenhuma delas. Todas são opcionais: sem elas, o recurso correspondente fica desligado e o bot avisa em uma linha.

```dotenv
INEMAVOX_URL=http://localhost:8010   # STT + TTS locais (preferencial)
VOZ_TTS_ENGINE=chatterbox
VOZ_TTS_VOICE=rachel
GROQ_API_KEY=                        # fallback de STT (copiar do .env do v2 ou do wifi, não duplicar à toa)
ELEVENLABS_API_KEY=                  # fallback de TTS (opcional)
ELEVENLABS_VOICE_ID=
VOZ_MAX_SEGUNDOS=300                 # teto de áudio recebido
VOZ_MAX_CHARS_FALA=400               # teto do texto que vira áudio
```

### 2.5 Regras a respeitar

- **Custo:** o `custo/gateway.ts` hoje registra chamadas de LLM. As chamadas pagas de voz (Groq, ElevenLabs) devem gravar uma linha de custo equivalente (ou uma tabela `chamadas_voz`), para aparecerem em `/usage` e no orçamento. O inemavox é local e grava custo 0, mas grava a latência.
- **Fila `io`:** transcrever e sintetizar não podem travar a fila `chat`. Um áudio de 5 minutos não segura as outras conversas.
- **Chats observados:** uma nota de voz num chat só **observado** não é transcrita por padrão (custa GPU ou Groq). Opção `VOZ_OBSERVAR=1` para ligar.
- **Guarda:** o mesmo filtro de `papelDoChat`. Voz vinda de chat `ignorar` é descartada antes do download.
- **Falha da voz nunca derruba a resposta:** se o TTS falhar, o texto já foi enviado. Registrar em `FALHAS.md` quando for falha real.
- **Tamanho:** os três módulos `voz/*` ficam bem abaixo de 500 linhas. O v2 junta tudo num arquivo de 388; aqui ele é separado.

### 2.6 Verificação

- Testes (vitest): `limpar.ts` (markdown, citações, valores); escolha de provedor (inemavox fora do ar → Groq); `/voz` persistido; `papelDoChat` antes do download.
- `npm run doctor`: linha "voz" com o inemavox respondendo `/api/health`, o `ffmpeg` presente e os provedores de reserva configurados.
- Aceite manual no chat de conversa do v3:
  1. mandar uma nota de voz "que horas são no Japão?" e receber a transcrição, o texto e a voz;
  2. `/voz sempre` e depois mandar texto: recebe texto e voz;
  3. parar o inemavox e mandar voz: a transcrição vem pelo Groq, e o log mostra o fallback;
  4. reiniciar o serviço: `/voz` continua `sempre`.

### 2.7 Relação com o Jarvis v7

A especificação do Jarvis no Telegram (`~/projetos/jarvisv7/docs/especificacao-telegram.md`) usa o mesmo desenho: long-polling, voz OGG/Opus via ffmpeg e inemavox com reserva paga. Ela acrescenta pareamento por código e uma tabela de envios idempotente. Se os dois forem implementados, `limpar.ts` e o cliente do inemavox são candidatos a um pacote comum.
