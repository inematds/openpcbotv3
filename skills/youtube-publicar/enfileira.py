#!/usr/bin/env python3
"""Coloca um vídeo na FILA de uma instância yt-pub-lives (pasta imports/), com texto e thumb prontos.

  enfileira.py <video.mp4> --plano <plano.json do yt-pubx --dry-run> [--canal lives1] [--copiar]

O lote vira uma subpasta em ~/projetos/yt-pub-<canal>/imports/ com o MP4, a thumb e o manifest.json
(título, descrição, tags, thumbnail, privacy). O scheduler da instância importa na hora cheia e
publica nos horários de `import_pub_horarios` (1 por horário). Nada é publicado por este script.
"""
import argparse, json, os, re, shutil, sys

p = argparse.ArgumentParser()
p.add_argument('video')
p.add_argument('--plano', required=True)
p.add_argument('--canal', default='lives1')
p.add_argument('--privacy', default='public', choices=['public', 'unlisted', 'private'])
p.add_argument('--copiar', action='store_true', help='copia o MP4 (padrão: move)')
a = p.parse_args()

inst = os.path.expanduser(f'~/projetos/yt-pub-{a.canal.removeprefix("yt-pub-")}')
imports = os.path.join(inst, 'imports')
if not os.path.isdir(imports):
    sys.exit(f'instância sem imports/: {inst}')
pl = json.load(open(a.plano, encoding='utf-8'))
sn = pl['youtube']['snippet']
thumb = pl.get('thumb')
if not thumb or not os.path.exists(thumb):
    sys.exit(f'plano sem thumb: {a.plano}')

nome = re.sub(r'[^a-zA-Z0-9_-]+', '-', os.path.splitext(os.path.basename(a.video))[0])[:36].strip('-')
tmp = os.path.join(imports, f'.{nome}.tmp')   # pasta oculta: o scheduler não pega pela metade
os.makedirs(tmp, exist_ok=True)
mp4 = os.path.basename(a.video)
(shutil.copy2 if a.copiar else shutil.move)(a.video, os.path.join(tmp, mp4))
shutil.copy2(thumb, os.path.join(tmp, 'thumb.jpg'))
json.dump({'titulo': sn['title'][:80], 'privacy': a.privacy,
           'clips': [{'file': mp4, 'title': sn['title'], 'description': sn['description'],
                      'tags': sn.get('tags', []), 'thumbnail': 'thumb.jpg'}]},
          open(os.path.join(tmp, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
final = os.path.join(imports, nome)
n = 2
while os.path.exists(final):
    final = os.path.join(imports, f'{nome}-{n}')
    n += 1
os.rename(tmp, final)
print(f'Na fila: {final}')
