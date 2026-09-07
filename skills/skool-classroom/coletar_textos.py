#!/usr/bin/env python3
"""Baixa o CONTEÚDO DE TEXTO (material escrito) de cada aula de um classroom do Skool.

O texto de cada aula está em node.metadata.desc = "[v2]" + JSON ProseMirror (tiptap),
carregado por aula via ?md=<id>. Converte para Markdown e salva 1 arquivo por aula.

Uso:
  coletar_textos.py <url-classroom> <pasta-destino>

Cookie: usa SKOOL_COOKIE do ambiente (com auth_token + aws-waf-token) ou .env do openpcbot.
Nome do arquivo: <curso>__<NN>-<titulo>.md  (mesmo padrão do classroom.py)
"""
import sys, os, re, json, time, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classroom import load_cookie, fetch, next_data, slug, enumerate_tree, UA, REFERER


def find_node(pp, nid):
    found = [None]
    def walk(o):
        if found[0] is not None:
            return
        if isinstance(o, dict):
            if o.get("id") == nid and isinstance(o.get("metadata"), dict):
                found[0] = o
            else:
                for v in o.values():
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(pp.get("course"))
    return found[0]


# ---- ProseMirror/tiptap -> Markdown ----
def render_text(node):
    t = node.get("text", "")
    for mk in node.get("marks", []):
        ty = mk.get("type")
        if ty in ("bold", "strong"):
            t = f"**{t}**"
        elif ty in ("italic", "em"):
            t = f"*{t}*"
        elif ty == "code":
            t = f"`{t}`"
        elif ty in ("strike",):
            t = f"~~{t}~~"
        elif ty == "link":
            href = (mk.get("attrs") or {}).get("href", "")
            href = re.sub(r"\s+", "", href)  # Skool às vezes quebra a URL com \n no href
            if t.strip().startswith("http"):
                t = re.sub(r"\s+", "", t)  # texto visível também é a URL colada
            t = f"[{t}]({href})"
    return t


def render_inline(content):
    out = []
    for n in content or []:
        ty = n.get("type")
        if ty == "text":
            out.append(render_text(n))
        elif ty == "hardBreak":
            out.append("  \n")
        elif ty == "mention":
            out.append("@" + ((n.get("attrs") or {}).get("label") or (n.get("attrs") or {}).get("id") or ""))
        else:
            out.append(render_inline(n.get("content")))
    return "".join(out)


def render_block(node, depth=0):
    ty = node.get("type")
    attrs = node.get("attrs") or {}
    content = node.get("content") or []
    if ty == "paragraph":
        return render_inline(content)
    if ty == "heading":
        lvl = attrs.get("level", 2)
        return "#" * max(1, min(6, lvl)) + " " + render_inline(content)
    if ty == "blockquote":
        inner = "\n".join(render_block(c, depth) for c in content)
        return "\n".join("> " + ln for ln in inner.splitlines())
    if ty in ("codeBlock", "code_block"):
        lang = attrs.get("language") or ""
        return f"```{lang}\n" + render_inline(content) + "\n```"
    if ty in ("bulletList", "bullet_list"):
        return "\n".join(render_list_item(c, depth, "- ") for c in content)
    if ty in ("orderedList", "ordered_list"):
        return "\n".join(render_list_item(c, depth, f"{i+1}. ") for i, c in enumerate(content))
    if ty in ("horizontalRule", "horizontal_rule"):
        return "---"
    if ty == "image":
        return f"![]({attrs.get('src','')})"
    if ty in ("listItem", "list_item"):
        return render_list_item(node, depth, "- ")
    # fallback: tenta inline
    return render_inline(content)


def render_list_item(item, depth, marker):
    pad = "  " * depth
    parts = []
    for c in item.get("content") or []:
        if c.get("type") in ("bulletList", "orderedList", "bullet_list", "ordered_list"):
            parts.append(render_block(c, depth + 1))
        else:
            parts.append(render_block(c, depth))
    body = "\n".join(p for p in parts if p is not None)
    lines = body.splitlines() or [""]
    first = pad + marker + lines[0]
    rest = [pad + "  " + ln for ln in lines[1:]]
    return "\n".join([first] + rest)


_URLFRAG = re.compile(r"^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$")


def _is_url_fragment(block):
    """Parágrafo que é só a CONTINUAÇÃO de uma URL quebrada pelo Skool:
    um único text node, sem marcas, sem espaços, com chars válidos de URL,
    e que não inicia uma URL nova (não começa com http)."""
    if block.get("type") != "paragraph":
        return None
    c = block.get("content") or []
    if len(c) != 1 or c[0].get("type") != "text" or c[0].get("marks"):
        return None
    t = c[0].get("text", "")
    if len(t) < 12 or t.startswith("http") or not _URLFRAG.match(t):
        return None
    return t


def _rejoin_broken_urls(doc):
    """Recola URLs que o Skool partiu em vários parágrafos após um link."""
    i = 0
    while i < len(doc):
        b = doc[i]
        content = b.get("content") if isinstance(b, dict) else None
        last = content[-1] if content else None
        is_link = (isinstance(last, dict) and last.get("type") == "text"
                   and any(m.get("type") == "link" for m in last.get("marks", [])))
        if is_link:
            frags, j = [], i + 1
            while j < len(doc):
                f = _is_url_fragment(doc[j])
                if f is None:
                    break
                frags.append(f)
                j += 1
            if frags:
                extra = "".join(frags)
                last["text"] = last.get("text", "") + extra
                for m in last["marks"]:
                    if m.get("type") == "link":
                        a = m.setdefault("attrs", {})
                        a["href"] = (a.get("href") or "") + extra
                del doc[i + 1:j]
        i += 1
    return doc


def desc_to_md(desc):
    d = re.sub(r"^\[v\d+\]", "", desc).strip()
    if not d:
        return ""
    try:
        doc = json.loads(d)
    except Exception:
        return desc  # devolve cru se não for JSON
    if isinstance(doc, dict):
        doc = doc.get("content", [])
    doc = _rejoin_broken_urls(doc)
    return "\n\n".join(render_block(b) for b in doc).strip()


def render_resources(res):
    if not res:
        return ""
    if isinstance(res, str):
        try:
            res = json.loads(res)
        except Exception:
            return ""
    if not res:
        return ""
    out = ["\n\n## Recursos / Anexos\n"]
    for r in res:
        if not isinstance(r, dict):
            continue
        label = r.get("label") or r.get("title") or r.get("name") or "link"
        href = r.get("url") or r.get("href") or r.get("link") or ""
        out.append(f"- [{label}]({href})" if href else f"- {label}")
    return "\n".join(out)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    url, dest = sys.argv[1], sys.argv[2]
    cookie = load_cookie()
    os.makedirs(dest, exist_ok=True)
    base = url.split("?")[0]

    pp0 = next_data(fetch(url, cookie))
    course_name, nodes = enumerate_tree(pp0)
    cslug = slug(course_name, 50)
    sys.stderr.write(f"curso: {course_name} | {len(nodes)} nós, buscando texto de cada...\n")

    ok, empty, fail = [], [], []
    for i, n in enumerate(nodes, 1):
        nid, title, order = n["id"], n["title"], n["order"]
        try:
            pp = next_data(fetch(f"{base}?md={nid}", cookie))
        except Exception as e:
            fail.append((title, str(e)))
            continue
        node = find_node(pp, nid)
        meta = (node or {}).get("metadata") or {}
        md = desc_to_md(meta.get("desc") or "")
        if not md.strip():
            empty.append(title)
            time.sleep(0.15)
            continue
        body = f"# {title}\n"
        if n.get("module"):
            body += f"\n*{n['module']}*\n"
        body += "\n" + md + render_resources(meta.get("resources"))
        fname = f"{cslug}__{order:02d}-{slug(title)}.md"
        with open(os.path.join(dest, fname), "w", encoding="utf-8") as f:
            f.write(body.rstrip() + "\n")
        ok.append(fname)
        print(f"  ✓ {order:02d} {title}  ({len(md)} chars)")
        time.sleep(0.2)

    print(f"\nPRONTO: {len(ok)} aulas com texto salvas em {dest}")
    if empty:
        print(f"  {len(empty)} sem texto (seções/headers ou aula só-vídeo)")
    if fail:
        print(f"  {len(fail)} falhas:")
        for t, e in fail:
            print("   -", t, "|", e)


if __name__ == "__main__":
    main()
