#!/usr/bin/env python3
"""Gmail CLI multi-conta para o openpcbot v3.

Uma credencial OAuth serve todas as contas; cada conta tem seu token.
Saída sempre em JSON (é consumida pelo bot).

Uso:
  gmail.py contas                              lista os aliases configurados
  gmail.py --conta pessoal auth                autentica (abre URL, uma vez por conta)
  gmail.py --conta todas list --nao-lidas      caixa de entrada
  gmail.py --conta todas recentes --horas 6    o que chegou nas últimas N horas (ingestão)
  gmail.py --conta pessoal ler <id>            corpo da mensagem
  gmail.py --conta pessoal buscar "fatura"     busca com a sintaxe do Gmail
  gmail.py --conta pessoal enviar --para a@b --assunto X --texto Y

`--conta` aceita: um alias, vários separados por vírgula, ou `todas`.
"""
from __future__ import annotations

import argparse
import base64
import sys
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from comum import (  # noqa: E402
    SCOPES_GMAIL, carregar_contas, credenciais, imprimir, resolver_contas, servico_google,
)

SERVICO = "gmail"


def _svc(conta: str, interativo: bool = False):
    return servico_google("gmail", "v1", conta, SCOPES_GMAIL, SERVICO, interativo)


def _cabecalho(msg: dict, nome: str) -> str:
    for h in msg.get("payload", {}).get("headers", []):
        if h.get("name", "").lower() == nome.lower():
            return h.get("value", "")
    return ""


def _corpo(payload: dict) -> str:
    """Texto puro da mensagem, preferindo text/plain sobre text/html."""
    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", "replace")
    for parte in payload.get("parts", []) or []:
        if parte.get("mimeType") == "text/plain" and parte.get("body", {}).get("data"):
            return base64.urlsafe_b64decode(parte["body"]["data"]).decode("utf-8", "replace")
    for parte in payload.get("parts", []) or []:
        texto = _corpo(parte)
        if texto:
            return texto
    dados = payload.get("body", {}).get("data")
    return base64.urlsafe_b64decode(dados).decode("utf-8", "replace") if dados else ""


def _resumir(svc, conta: str, ids: list[str], com_corpo: bool = False) -> list[dict]:
    out = []
    for mid in ids:
        m = svc.users().messages().get(userId="me", id=mid, format="full" if com_corpo else "metadata",
                                       metadataHeaders=["From", "To", "Subject", "Date"]).execute()
        item = {
            "conta": conta,
            "id": m["id"],
            "threadId": m.get("threadId"),
            "de": _cabecalho(m, "From"),
            "para": _cabecalho(m, "To"),
            "assunto": _cabecalho(m, "Subject"),
            "data": _cabecalho(m, "Date"),
            "resumo": m.get("snippet", ""),
            "nao_lida": "UNREAD" in (m.get("labelIds") or []),
        }
        if com_corpo:
            item["corpo"] = _corpo(m.get("payload", {}))[:20000]
        out.append(item)
    return out


def cmd_list(conta: str, limite: int, nao_lidas: bool) -> list[dict]:
    svc = _svc(conta)
    q = "is:unread in:inbox" if nao_lidas else "in:inbox"
    r = svc.users().messages().list(userId="me", q=q, maxResults=limite).execute()
    return _resumir(svc, conta, [m["id"] for m in r.get("messages", [])])


def cmd_recentes(conta: str, horas: int, limite: int) -> list[dict]:
    """O que chegou nas últimas N horas — é o que a ingestão do bot consome."""
    svc = _svc(conta)
    depois = int((datetime.now(timezone.utc) - timedelta(hours=horas)).timestamp())
    r = svc.users().messages().list(userId="me", q=f"after:{depois}", maxResults=limite).execute()
    return _resumir(svc, conta, [m["id"] for m in r.get("messages", [])])


def cmd_buscar(conta: str, consulta: str, limite: int) -> list[dict]:
    svc = _svc(conta)
    r = svc.users().messages().list(userId="me", q=consulta, maxResults=limite).execute()
    return _resumir(svc, conta, [m["id"] for m in r.get("messages", [])])


def cmd_ler(conta: str, msg_id: str) -> dict:
    return _resumir(_svc(conta), conta, [msg_id], com_corpo=True)[0]


def cmd_enviar(conta: str, para: str, assunto: str, texto: str) -> dict:
    svc = _svc(conta)
    msg = MIMEText(texto, _charset="utf-8")
    msg["to"], msg["subject"] = para, assunto
    bruto = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    r = svc.users().messages().send(userId="me", body={"raw": bruto}).execute()
    return {"conta": conta, "enviado": r.get("id"), "para": para}


def cmd_marcar_lida(conta: str, msg_id: str) -> dict:
    svc = _svc(conta)
    svc.users().messages().modify(userId="me", id=msg_id, body={"removeLabelIds": ["UNREAD"]}).execute()
    return {"conta": conta, "id": msg_id, "lida": True}


def main() -> None:
    p = argparse.ArgumentParser(description="Gmail multi-conta", add_help=True)
    p.add_argument("--conta", help="alias, lista separada por vírgula, ou 'todas'")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("contas")
    sub.add_parser("auth")
    s = sub.add_parser("list"); s.add_argument("--limite", type=int, default=20); s.add_argument("--nao-lidas", action="store_true")
    s = sub.add_parser("recentes"); s.add_argument("--horas", type=int, default=6); s.add_argument("--limite", type=int, default=30)
    s = sub.add_parser("buscar"); s.add_argument("consulta"); s.add_argument("--limite", type=int, default=20)
    s = sub.add_parser("ler"); s.add_argument("id")
    s = sub.add_parser("marcar-lida"); s.add_argument("id")
    s = sub.add_parser("enviar")
    s.add_argument("--para", required=True); s.add_argument("--assunto", required=True); s.add_argument("--texto", required=True)
    a = p.parse_args()

    if a.cmd == "contas":
        imprimir({"contas": carregar_contas(), "config": str(__import__("comum").CONTAS_FILE)})
        return

    contas = resolver_contas(a.conta)

    if a.cmd == "auth":
        for c in contas:
            credenciais(SERVICO, c, SCOPES_GMAIL, interativo=True)
            print(f"✅ {c} autenticada para Gmail", file=sys.stderr)
        return

    agregado: list = []
    for c in contas:
        try:
            if a.cmd == "list":
                agregado += cmd_list(c, a.limite, a.nao_lidas)
            elif a.cmd == "recentes":
                agregado += cmd_recentes(c, a.horas, a.limite)
            elif a.cmd == "buscar":
                agregado += cmd_buscar(c, a.consulta, a.limite)
            elif a.cmd == "ler":
                agregado.append(cmd_ler(c, a.id))
            elif a.cmd == "marcar-lida":
                agregado.append(cmd_marcar_lida(c, a.id))
            elif a.cmd == "enviar":
                agregado.append(cmd_enviar(c, a.para, a.assunto, a.texto))
        except SystemExit:
            raise
        except Exception as e:
            # Uma conta quebrada (token revogado) não derruba as outras.
            print(f"AVISO: conta {c} falhou: {e}", file=sys.stderr)
    imprimir(agregado)


if __name__ == "__main__":
    main()
