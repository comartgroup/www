#!/usr/bin/env python3
"""
COMART 官網靜態產生器

把 src/ 底下的版型、共用區塊與各頁內容，組合成 GitHub Pages 可直接服務的靜態頁面。

用法：
    python3 build.py            # 產生全站
    python3 build.py --clean    # 先刪除上次產生的頁面再重建

設計原則：
- 不依賴 npm、不需要 CI，產生結果直接 commit 進 repo
- 頁首／頁尾只維護一份（src/partials/），避免多頁不同步
- {{ROOT}} 讓同一份共用區塊在任何目錄深度都能正確指向資產與頁面
- 三語版本以 src/content/pages.<lang>.json 擴充；目前只有 en 有完整內容
"""

import json
import os
import re
import shutil
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'src')

SITE_URL = 'https://comartgroup.github.io/www/'
LANGS = ['en']                      # 之後加入 'zh-TW', 'vi'
DEFAULT_LANG = 'en'


def read(*parts):
    with open(os.path.join(*parts), encoding='utf-8') as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def root_for(out_path):
    """由輸出路徑推算回到站台根目錄的相對前綴。"""
    depth = out_path.count('/')
    return '../' * depth if depth else ''


def render(page, layout, header, footer):
    """組出單一頁面的完整 HTML。"""
    out = page['out']
    root = root_for(out)
    body = read(SRC, 'pages', page['src'])

    html = layout
    html = html.replace('{{HEADER}}', header)
    html = html.replace('{{FOOTER}}', footer)
    html = html.replace('{{BODY}}', body)
    html = html.replace('{{TITLE}}', page['title'])
    html = html.replace('{{DESC}}', page['desc'])
    html = html.replace('{{LANG}}', page.get('lang', DEFAULT_LANG))
    html = html.replace('{{BODYCLASS}}', page.get('bodyclass', ''))
    html = html.replace('{{PATH}}', '' if out == 'index.html' else out.rsplit('index.html', 1)[0])
    html = html.replace('{{ROOT}}', root)

    # 目前頁面在主選單標示為 active
    nav = page.get('nav')
    if nav:
        html = html.replace('data-nav="%s"' % nav, 'data-nav="%s" class="is-current"' % nav)

    leftover = re.findall(r'\{\{[A-Z_]+\}\}', html)
    if leftover:
        raise SystemExit('未替換的樣板變數 %s（頁面 %s）' % (sorted(set(leftover)), out))
    return html


def build_sitemap(pages):
    urls = []
    for p in pages:
        loc = SITE_URL + ('' if p['out'] == 'index.html' else p['out'].rsplit('index.html', 1)[0])
        urls.append('  <url><loc>%s</loc></url>' % loc)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + '\n'.join(urls) + '\n</urlset>\n')


def main():
    pages = json.loads(read(SRC, 'content', 'pages.en.json'))['pages']
    layout = read(SRC, 'layout.html')
    header = read(SRC, 'partials', 'header.html')
    footer = read(SRC, 'partials', 'footer.html')

    if '--clean' in sys.argv:
        for p in pages:
            d = p['out'].split('/')[0]
            if d != 'index.html' and os.path.isdir(os.path.join(BASE, d)):
                shutil.rmtree(os.path.join(BASE, d))

    for p in pages:
        write(os.path.join(BASE, p['out']), render(p, layout, header, footer))
        print('  ✓ %-52s %s' % (p['out'], p['title'][:44]))

    write(os.path.join(BASE, 'sitemap.xml'), build_sitemap(pages))
    # robots.txt 只有放在「網域根目錄」才會被爬蟲讀取。
    # 目前站台在 comartgroup.github.io/www/ 子路徑下，這份是無效的；
    # 切換到 www.comart.com.tw（站台位於根目錄）之後才會開始生效。
    #
    # ★ 不要把 /webadmin/ 之類的路徑寫進 Disallow。
    #   robots.txt 必須公開可讀才能運作，寫進去等於主動公告後台位置。
    #   讓搜尋引擎不收錄後台，靠的是 webadmin/index.html 裡的
    #   <meta name="robots" content="noindex, nofollow">，那個才有效且不外洩路徑。
    write(os.path.join(BASE, 'robots.txt'),
          'User-agent: *\nAllow: /\nSitemap: %ssitemap.xml\n' % SITE_URL)
    print('\n%d 頁產生完成，另含 sitemap.xml 與 robots.txt' % len(pages))


if __name__ == '__main__':
    main()
