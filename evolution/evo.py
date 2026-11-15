#!/usr/bin/env python3
"""Operação da Evolution do v3 (instância "pessoal"). Lê a chave de evolution/.env, nunca a imprime.

  python3 evolution/evo.py criar     # cria a instância com grupos ignorados e sem histórico
  python3 evolution/evo.py qr        # mostra o QR no terminal (e salva evolution/qr.png) para ler no celular
  python3 evolution/evo.py qrvivo    # abre evolution/qr.html, que troca o QR a cada 15 s até conectar (3 min)
  python3 evolution/evo.py codigo 5548999990000   # código de 8 letras para digitar no celular (sem QR)
  python3 evolution/evo.py estado    # conectado? qual número? configurações
  python3 evolution/evo.py sair      # desconecta o WhatsApp (logout)
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
URL = 'http://127.0.0.1:18095'
INST = 'pessoal'
CONFIG = {'groupsIgnore': True, 'syncFullHistory': False, 'readMessages': False, 'readStatus': False,
          'alwaysOnline': False, 'rejectCall': False}


def chave():
    for linha in open(os.path.join(AQUI, '.env')):
        if linha.startswith('EVOLUTION_API_KEY='):
            return linha.split('=', 1)[1].strip()
    sys.exit('EVOLUTION_API_KEY ausente em evolution/.env')


def chamar(metodo, rota, corpo=None):
    req = urllib.request.Request(URL + rota, method=metodo, headers={'apikey': chave(), 'Content-Type': 'application/json'},
                                 data=json.dumps(corpo).encode() if corpo is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def criar():
    s, d = chamar('POST', '/instance/create', {'instanceName': INST, 'integration': 'WHATSAPP-BAILEYS', 'qrcode': False, **CONFIG})
    print('criar:', s, (d.get('instance') or {}).get('status') or d.get('response') or '')
    s, d = chamar('POST', f'/settings/set/{INST}', CONFIG)
    print('config:', s)
    estado()


def estado():
    _, lista = chamar('GET', f'/instance/fetchInstances?instanceName={INST}')
    i = lista[0] if isinstance(lista, list) and lista else {}
    dono = (i.get('ownerJid') or '').split('@')[0]
    print('conexão:', i.get('connectionStatus'), '· número:', (dono[:4] + '…' + dono[-2:]) if dono else '(falta ler o QR)')
    _, cfg = chamar('GET', f'/settings/find/{INST}')
    print('config:', {k: cfg.get(k) for k in CONFIG})


def qr():
    s, d = chamar('GET', f'/instance/connect/{INST}')
    codigo, img = d.get('code'), d.get('base64')
    if not codigo:
        print('sem QR:', s, d)
        return
    if img and ',' in img:
        open(os.path.join(AQUI, 'qr.png'), 'wb').write(base64.b64decode(img.split(',', 1)[1]))
    if shutil.which('qrencode'):
        subprocess.run(['qrencode', '-t', 'ANSIUTF8', codigo])
    print('QR salvo em', os.path.join(AQUI, 'qr.png'), '— vale ~40 s; se expirar, rode de novo.')
    print('No celular: WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho.')


def codigo(numero=''):
    numero = ''.join(c for c in numero if c.isdigit())
    if len(numero) < 12:
        sys.exit('use: evo.py codigo 55DDDNUMERO (com 55 e DDD, só dígitos)')
    chamar('DELETE', f'/instance/logout/{INST}')  # zera a tentativa de QR pendente
    s, d = chamar('GET', f'/instance/connect/{INST}?number={numero}')
    pc = d.get('pairingCode')
    if not pc:
        print('sem código:', s, d)
        return
    print('\n   CÓDIGO:', pc[:4] + '-' + pc[4:], '\n')
    print('No celular: WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho →')
    print('"Conectar com número de telefone" (embaixo do leitor de QR) → digite o código. Vale ~2 min.')


def qrvivo():
    import time
    html = os.path.join(AQUI, 'qr.html')
    def pagina(corpo):
        open(html, 'w').write('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3">'
                              '<body style="background:#fff;font:20px sans-serif;text-align:center;padding:24px">' + corpo)
    pagina('Gerando o QR…')
    subprocess.Popen(['xdg-open', html], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    fim = time.time() + 180
    while time.time() < fim:
        _, lista = chamar('GET', f'/instance/fetchInstances?instanceName={INST}')
        i = lista[0] if isinstance(lista, list) and lista else {}
        if i.get('connectionStatus') == 'open':
            pagina('<h1>✅ Conectado!</h1>Pode fechar esta página.')
            print('Conectado.')
            return
        _, d = chamar('GET', f'/instance/connect/{INST}')
        if d.get('base64'):
            pagina(f'<p>WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho</p>'
                   f'<img src="{d["base64"]}" style="width:420px;height:420px"><p>O QR troca sozinho a cada 15 s.</p>')
        time.sleep(15)
    pagina('Tempo esgotado. Rode <code>evo.py qrvivo</code> de novo.')
    print('Tempo esgotado.')


def _env(arq, nome):
    if not os.path.exists(arq):
        return ''
    for linha in open(arq):
        if linha.startswith(nome + '='):
            return linha.split('=', 1)[1].strip().strip('"\'')
    return ''


def _telegram_v3(texto):
    """Manda no chat do Nei pelo bot v3. Devolve os números das mensagens."""
    v3 = os.path.join(AQUI, '..', '.env')
    v2 = os.path.expanduser('~/projetos/openpcbotv2/.env')
    tok = _env(v3, 'TELEGRAM_BOT_TOKEN_V3')
    chat = _env(v3, 'ALLOWED_CHAT_ID') or _env(v2, 'ALLOWED_CHAT_ID')
    if not tok or not chat:
        sys.exit('faltam TELEGRAM_BOT_TOKEN_V3/ALLOWED_CHAT_ID')
    partes, atual = [], ''
    for linha in texto.split('\n'):
        if len(atual) + len(linha) > 3800:
            partes.append(atual)
            atual = ''
        atual += linha + '\n'
    partes.append(atual)
    ids = []
    for p in partes:
        req = urllib.request.Request(f'https://api.telegram.org/bot{tok}/sendMessage',
                                     data=json.dumps({'chat_id': chat, 'text': p}).encode(),
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as r:
            ids.append(json.loads(r.read())['result']['message_id'])
    return ids


def grupos():
    """Lista numerada dos grupos (só nomes e nº de pessoas, nenhuma mensagem) → bot v3 + evolution/grupos.json.
    Os nomes não saem no terminal."""
    s, d = chamar('GET', f'/group/fetchAllGroups/{INST}?getParticipants=false')
    if s != 200 or not isinstance(d, list):
        sys.exit(f'falhou: HTTP {s}')
    lista = sorted(({'id': g.get('id'), 'nome': (g.get('subject') or '(sem nome)').strip(), 'pessoas': g.get('size')} for g in d),
                   key=lambda g: g['nome'].lower())
    for n, g in enumerate(lista, 1):
        g['n'] = n
    arq = os.path.join(AQUI, 'grupos.json')
    with open(arq, 'w') as f:
        json.dump(lista, f, ensure_ascii=False, indent=1)
    os.chmod(arq, 0o600)
    linhas = [f'WhatsApp: seus {len(lista)} grupos (só nomes, nenhuma mensagem lida).',
              'Responda com os números que PODEM ser acessados, ex.: "podem: 3, 7, 12". Os outros ficam bloqueados.', '']
    linhas += [f"{g['n']}. {g['nome']}" + (f" ({g['pessoas']})" if g['pessoas'] else '') for g in lista]
    ids = _telegram_v3('\n'.join(linhas))
    print(f'{len(lista)} grupos → bot v3, msg {", ".join(map(str, ids))}; mapa em {arq}')


def sair():
    print('logout:', chamar('DELETE', f'/instance/logout/{INST}')[0])


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'codigo':
        codigo(sys.argv[2] if len(sys.argv) > 2 else '')
    else:
        {'criar': criar, 'qr': qr, 'qrvivo': qrvivo, 'grupos': grupos, 'estado': estado, 'sair': sair}.get(cmd, lambda: print(__doc__))()
