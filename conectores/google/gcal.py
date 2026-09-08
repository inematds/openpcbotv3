#!/usr/bin/env python3
"""Google Calendar CLI — multi-account support.

Accounts: inematds, nei2014, nei2024
Each account has its own token file. Credentials (OAuth client) are shared.

Usage:
  gcal.py [--account ACCOUNT] <command> [options]

Commands:
  auth                    Authenticate an account (opens browser)
  list                    List upcoming events (default: next 10)
  list --days N           Events within N days
  list --all              Aggregate from all accounts
  get EVENT_ID            Get event details
  create                  Create an event (see options below)
  update EVENT_ID         Update an event field
  delete EVENT_ID         Delete/cancel an event
  freebusy                Check free/busy for a time range

Create options:
  --title TEXT
  --date YYYY-MM-DD
  --time HH:MM            (24h, uses TIMEZONE)
  --duration N            Minutes (default 60)
  --end-time HH:MM        Alternative to --duration
  --description TEXT
  --attendees a@b.com,c@d.com
  --meet                  Add Google Meet link
  --all-day               All-day event
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).parent))
from comum import (  # noqa: E402
    CONFIG_DIR, CREDS_FILE, SCOPES_GCAL as SCOPES, TIMEZONE, carregar_contas,
    conta_padrao, credenciais, resolver_contas,
)

ACCOUNTS = carregar_contas()
DEFAULT_ACCOUNT = conta_padrao()


def token_path(account: str) -> Path:
    return CONFIG_DIR / f"token_gcal_{account}.json"


# ── Auth ──────────────────────────────────────────────────────────────────────

def get_service(account: str, interativo: bool = False):
    """Auth compartilhada com o Gmail (comum.py): 1 credencial, 1 token por conta."""
    from googleapiclient.discovery import build

    return build("calendar", "v3",
                 credentials=credenciais("gcal", account, SCOPES, interativo),
                 cache_discovery=False)


# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_datetime(date_str: str, time_str: str | None, tz_name: str) -> str:
    """Return RFC3339 string for a date+time in the given timezone."""
    import zoneinfo
    tz = zoneinfo.ZoneInfo(tz_name)
    if time_str:
        dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
    else:
        dt = datetime.strptime(date_str, "%Y-%m-%d").replace(hour=0, minute=0)
    dt = dt.replace(tzinfo=tz)
    return dt.isoformat()


def format_event(ev: dict, account: str | None = None) -> dict:
    start = ev.get("start", {})
    end = ev.get("end", {})
    attendees = [a["email"] for a in ev.get("attendees", [])]
    meet_link = None
    for ep in ev.get("conferenceData", {}).get("entryPoints", []):
        if ep.get("entryPointType") == "video":
            meet_link = ep.get("uri")
    out = {
        "id": ev["id"],
        "summary": ev.get("summary", "(no title)"),
        "start": start.get("dateTime", start.get("date")),
        "end": end.get("dateTime", end.get("date")),
        "attendees": attendees,
        "meet_link": meet_link,
        "description": ev.get("description", ""),
        "status": ev.get("status", ""),
    }
    if account:
        out["account"] = account
    return out


def now_rfc3339() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_auth(account: str):
    tp = token_path(account)
    if tp.exists():
        tp.unlink()
        print(f"Removed old token for {account}")
    get_service(account, interativo=True)
    print(f"Auth complete for {ACCOUNTS[account]}")


def cmd_list(account: str, days: int = 30, limit: int = 20) -> list:
    svc = get_service(account)
    time_min = now_rfc3339()
    time_max = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    result = svc.events().list(
        calendarId="primary",
        timeMin=time_min,
        timeMax=time_max,
        maxResults=limit,
        singleEvents=True,
        orderBy="startTime",
    ).execute()
    return [format_event(e, account) for e in result.get("items", [])]


def cmd_list_all(days: int = 30, limit: int = 20) -> list:
    all_events = []
    for account in ACCOUNTS:
        try:
            events = cmd_list(account, days=days, limit=limit)
            all_events.extend(events)
        except Exception as e:
            print(f"WARNING: {account} failed: {e}", file=sys.stderr)
    # sort by start time
    all_events.sort(key=lambda e: e["start"] or "")
    return all_events


def cmd_get(account: str, event_id: str) -> dict:
    svc = get_service(account)
    ev = svc.events().get(calendarId="primary", eventId=event_id).execute()
    return format_event(ev, account)


def cmd_create(
    account: str,
    title: str,
    date: str,
    time_str: str | None = None,
    duration: int = 60,
    end_time: str | None = None,
    description: str = "",
    attendees: list[str] | None = None,
    meet: bool = False,
    all_day: bool = False,
) -> dict:
    svc = get_service(account)

    body: dict = {
        "summary": title,
        "description": description,
    }

    if all_day:
        body["start"] = {"date": date}
        body["end"] = {"date": date}
    else:
        tz = TIMEZONE
        start_dt = parse_datetime(date, time_str or "09:00", tz)
        if end_time:
            end_dt = parse_datetime(date, end_time, tz)
        else:
            from zoneinfo import ZoneInfo
            start = datetime.fromisoformat(start_dt)
            end = start + timedelta(minutes=duration)
            end_dt = end.isoformat()
        body["start"] = {"dateTime": start_dt, "timeZone": tz}
        body["end"]   = {"dateTime": end_dt,   "timeZone": tz}

    if attendees:
        body["attendees"] = [{"email": e} for e in attendees]

    if meet:
        import uuid
        body["conferenceData"] = {
            "createRequest": {
                "requestId": str(uuid.uuid4()),
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        }

    kwargs = {"calendarId": "primary", "body": body, "sendUpdates": "all"}
    if meet:
        kwargs["conferenceDataVersion"] = 1

    ev = svc.events().insert(**kwargs).execute()
    return format_event(ev, account)


def cmd_delete(account: str, event_id: str) -> dict:
    svc = get_service(account)
    svc.events().delete(calendarId="primary", eventId=event_id, sendUpdates="all").execute()
    return {"deleted": event_id, "account": account}


def cmd_update(account: str, event_id: str, field: str, value: str) -> dict:
    svc = get_service(account)
    ev = svc.events().get(calendarId="primary", eventId=event_id).execute()
    if field == "title":
        ev["summary"] = value
    elif field == "description":
        ev["description"] = value
    elif field == "date":
        for key in ("start", "end"):
            dt_str = ev[key].get("dateTime") or ev[key].get("date")
            if "T" in (dt_str or ""):
                old = datetime.fromisoformat(dt_str)
                new = old.replace(
                    year=int(value[:4]),
                    month=int(value[5:7]),
                    day=int(value[8:10]),
                )
                ev[key]["dateTime"] = new.isoformat()
            else:
                ev[key]["date"] = value
    updated = svc.events().update(
        calendarId="primary", eventId=event_id, body=ev, sendUpdates="all"
    ).execute()
    return format_event(updated, account)


def cmd_freebusy(account: str, date: str, days: int = 1) -> dict:
    import zoneinfo
    svc = get_service(account)
    tz = zoneinfo.ZoneInfo(TIMEZONE)
    t_min = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=tz).isoformat()
    t_max = (datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=tz) + timedelta(days=days)).isoformat()
    body = {
        "timeMin": t_min,
        "timeMax": t_max,
        "items": [{"id": "primary"}],
    }
    result = svc.freebusy().query(body=body).execute()
    busy = result.get("calendars", {}).get("primary", {}).get("busy", [])
    return {"account": account, "date": date, "busy": busy}


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Google Calendar CLI")
    parser.add_argument("--conta", "--account", default=DEFAULT_ACCOUNT, choices=list(ACCOUNTS.keys()),
                        help=f"Account alias (default: {DEFAULT_ACCOUNT})")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("auth", help="Authenticate account")

    p_list = sub.add_parser("list", help="List events")
    p_list.add_argument("--days", type=int, default=30)
    p_list.add_argument("--limit", type=int, default=20)
    p_list.add_argument("--all", action="store_true", dest="all_accounts",
                        help="Aggregate from all accounts")

    p_get = sub.add_parser("get", help="Get event by ID")
    p_get.add_argument("event_id")

    p_create = sub.add_parser("create", help="Create event")
    p_create.add_argument("--title", required=True)
    p_create.add_argument("--date", required=True, help="YYYY-MM-DD")
    p_create.add_argument("--time", dest="time_str", help="HH:MM (24h)")
    p_create.add_argument("--duration", type=int, default=60, help="Minutes")
    p_create.add_argument("--end-time", dest="end_time", help="HH:MM (24h)")
    p_create.add_argument("--description", default="")
    p_create.add_argument("--attendees", help="Comma-separated emails")
    p_create.add_argument("--meet", action="store_true")
    p_create.add_argument("--all-day", action="store_true", dest="all_day")

    p_update = sub.add_parser("update", help="Update event field")
    p_update.add_argument("event_id")
    p_update.add_argument("--field", required=True, choices=["title", "description", "date"])
    p_update.add_argument("--value", required=True)

    p_delete = sub.add_parser("delete", help="Delete event")
    p_delete.add_argument("event_id")

    p_free = sub.add_parser("freebusy", help="Check free/busy")
    p_free.add_argument("--date", required=True, help="YYYY-MM-DD")
    p_free.add_argument("--days", type=int, default=1)

    args = parser.parse_args()
    account = args.account

    result = None

    if args.command == "auth":
        cmd_auth(account)
        return

    elif args.command == "list":
        if args.all_accounts:
            result = cmd_list_all(days=args.days, limit=args.limit)
        else:
            result = cmd_list(account, days=args.days, limit=args.limit)

    elif args.command == "get":
        result = cmd_get(account, args.event_id)

    elif args.command == "create":
        attendees = [a.strip() for a in args.attendees.split(",")] if args.attendees else None
        result = cmd_create(
            account=account,
            title=args.title,
            date=args.date,
            time_str=args.time_str,
            duration=args.duration,
            end_time=args.end_time,
            description=args.description,
            attendees=attendees,
            meet=args.meet,
            all_day=args.all_day,
        )

    elif args.command == "update":
        result = cmd_update(account, args.event_id, args.field, args.value)

    elif args.command == "delete":
        result = cmd_delete(account, args.event_id)

    elif args.command == "freebusy":
        result = cmd_freebusy(account, args.date, args.days)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
