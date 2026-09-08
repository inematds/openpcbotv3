#!/usr/bin/env python3
"""Config e OAuth compartilhados pelos conectores Google (Gmail e Calendar).

Uma credencial (OAuth client) serve TODAS as contas; cada conta tem seu token.
Nada de e-mail ou segredo neste arquivo — as contas vivem em
`~/.config/google/contas.json` (fora do repo).

    ~/.config/google/
      credentials.json          OAuth client "Desktop" do Google Cloud (compartilhado)
      contas.json               {"alias": "email", ...}
      token_gmail_<alias>.json  criado por `gmail.py --conta <alias> auth`
      token_gcal_<alias>.json   criado por `gcal.py  --conta <alias> auth`
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

CONFIG_DIR = Path(os.environ.get("GOOGLE_CONFIG_DIR", "~/.config/google")).expanduser()
CREDS_FILE = Path(os.environ.get("GOOGLE_CREDS_PATH", CONFIG_DIR / "credentials.json")).expanduser()
CONTAS_FILE = Path(os.environ.get("GOOGLE_CONTAS_PATH", CONFIG_DIR / "contas.json")).expanduser()
TIMEZONE = os.environ.get("TZ_BOT", "America/Sao_Paulo")

SCOPES_GMAIL = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]
SCOPES_GCAL = ["https://www.googleapis.com/auth/calendar"]


def carregar_contas() -> dict[str, str]:
    """{alias: email}. Sem o arquivo, morre com instrução — nunca adivinha conta."""
    if not CONTAS_FILE.exists():
        sys.exit(
            f"ERRO: {CONTAS_FILE} não existe.\n"
            f'Crie com: mkdir -p {CONFIG_DIR} && echo \'{{"pessoal":"voce@gmail.com"}}\' > {CONTAS_FILE}\n'
            "Depois autentique cada alias: gmail.py --conta pessoal auth"
        )
    contas = json.loads(CONTAS_FILE.read_text())
    if not isinstance(contas, dict) or not contas:
        sys.exit(f"ERRO: {CONTAS_FILE} deve ser um objeto {{\"alias\": \"email\"}} não vazio.")
    return {str(k): str(v) for k, v in contas.items()}


def conta_padrao() -> str:
    return os.environ.get("GOOGLE_CONTA_PADRAO") or next(iter(carregar_contas()))


def resolver_contas(arg: str | None) -> list[str]:
    """`--conta` aceita alias, lista separada por vírgula, ou `todas`."""
    contas = carregar_contas()
    if arg in (None, ""):
        return [conta_padrao()]
    if arg in ("todas", "all", "*"):
        return list(contas)
    escolhidas = [a.strip() for a in arg.split(",") if a.strip()]
    for a in escolhidas:
        if a not in contas:
            sys.exit(f"ERRO: conta '{a}' não está em {CONTAS_FILE}. Disponíveis: {', '.join(contas)}")
    return escolhidas


def token_path(servico: str, conta: str) -> Path:
    return CONFIG_DIR / f"token_{servico}_{conta}.json"


def credenciais(servico: str, conta: str, scopes: list[str], interativo: bool = False):
    """Devolve credenciais válidas; renova sozinho quando o refresh_token existe."""
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    tp = token_path(servico, conta)
    creds = None
    if tp.exists():
        creds = Credentials.from_authorized_user_file(str(tp), scopes)
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            tp.write_text(creds.to_json())
            tp.chmod(0o600)
            return creds
        except Exception as e:  # refresh revogado: cai para o fluxo interativo
            if not interativo:
                sys.exit(f"ERRO: token de '{conta}' ({servico}) inválido: {e}\nRode: {servico}.py --conta {conta} auth")
    if not interativo:
        sys.exit(
            f"ERRO: conta '{conta}' não autenticada para {servico}.\n"
            f"Rode: python3 {servico}.py --conta {conta} auth"
        )
    if not CREDS_FILE.exists():
        sys.exit(
            f"ERRO: {CREDS_FILE} não existe.\n"
            "Crie um OAuth client tipo 'Desktop app' em console.cloud.google.com "
            "(APIs & Services → Credentials), baixe o JSON e salve nesse caminho."
        )
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), scopes)
    print(f"\nAutenticando {carregar_contas().get(conta, conta)} ({conta}) para {servico}…", file=sys.stderr)
    print("Abra a URL no navegador e faça login COM ESSA CONTA.\n", file=sys.stderr)
    creds = flow.run_local_server(port=0, open_browser=False)
    tp.write_text(creds.to_json())
    tp.chmod(0o600)
    return creds


def servico_google(nome: str, versao: str, conta: str, scopes: list[str], servico_token: str, interativo=False):
    from googleapiclient.discovery import build

    return build(nome, versao, credentials=credenciais(servico_token, conta, scopes, interativo), cache_discovery=False)


def imprimir(dados) -> None:
    json.dump(dados, sys.stdout, ensure_ascii=False, indent=2, default=str)
    print()
