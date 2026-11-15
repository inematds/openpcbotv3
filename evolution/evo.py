#!/usr/bin/env python3
"""Operação da Evolution do v3 (instância "pessoal"). Lê a chave de evolution/.env, nunca a imprime.

  python3 evolution/evo.py criar     # cria a instância com grupos ignorados e sem histórico
  python3 evolution/evo.py qr        # mostra o QR no terminal (e salva evolution/qr.png) para ler no celular
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


def sair():
    print('logout:', chamar('DELETE', f'/instance/logout/{INST}')[0])


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'codigo':
        codigo(sys.argv[2] if len(sys.argv) > 2 else '')
    else:
        {'criar': criar, 'qr': qr, 'estado': estado, 'sair': sair}.get(cmd, lambda: print(__doc__))()
