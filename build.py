#!/usr/bin/env python3
"""
COMART 官網靜態產生器

把 src/ 底下的版型、共用區塊與各頁內容，組合成 GitHub Pages 可直接服務的靜態頁面。

用法：
    python3 build.py            # 產生全站（三語）
    python3 build.py --clean    # 先刪除上次產生的頁面再重建

設計原則：
- 不依賴 npm、不需要 CI，產生結果直接 commit 進 repo
- 頁首／頁尾只維護一份 HTML，介面字串抽到 src/content/ui.<lang>.json
- {{ROOT}} 指向站台根目錄，用於三語共用的資產（CSS、JS、圖片）
- {{BASE}} 指向「當前語言」的根目錄，用於站內頁面連結；
  英文是站台根目錄，繁中是 /zh/，越南文是 /vi/

三語結構：
    英文     /              （維持在根目錄，既有連結與 SEO 不受影響）
    繁體中文 /zh/
    越南文   /vi/

各語言的頁面內容放在 src/pages/<lang>/，找不到就退回英文版，
所以翻譯可以一頁一頁補，不必一次到位。頁面標題與 SEO 描述同理，
放在 src/content/pages.<lang>.json，缺的欄位退回英文。
"""

import json
import os
import re
import shutil
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'src')

SITE_URL = 'https://comartgroup.github.io/www/'

# code = <html lang> 與檔名用的代碼；dir = 輸出目錄前綴；label = 語言切換鈕文字
LANGS = [
    {'code': 'en',    'dir': '',    'label': 'EN',   'name': 'English'},
    {'code': 'zh-TW', 'dir': 'zh/', 'label': '繁中', 'name': '繁體中文'},
    {'code': 'vi',    'dir': 'vi/', 'label': 'VN',   'name': 'Tiếng Việt'},
]
DEFAULT_LANG = 'en'


def read(*parts):
    with open(os.path.join(*parts), encoding='utf-8') as f:
        return f.read()


def read_or_none(*parts):
    path = os.path.join(*parts)
    return read(path) if os.path.exists(path) else None


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def root_for(out_path):
    """由輸出路徑推算回到站台根目錄的相對前綴。"""
    depth = out_path.count('/')
    return '../' * depth if depth else ''


def page_path(out):
    """out 轉成對外網址的路徑片段（去掉 index.html）。"""
    return '' if out == 'index.html' else out.rsplit('index.html', 1)[0]


def lang_nav(page_out, root, current_code):
    """語言切換鈕。指向同一頁的其他語言版本，而不是各語言的首頁。"""
    items = []
    for l in LANGS:
        href = root + l['dir'] + page_path(page_out)
        if l['code'] == current_code:
            items.append('<a href="%s" class="is-active" hreflang="%s" lang="%s">%s</a>'
                         % (href or './', l['code'], l['code'], l['label']))
        else:
            items.append('<a href="%s" hreflang="%s" lang="%s">%s</a>'
                         % (href or './', l['code'], l['code'], l['label']))
    return '\n      '.join(items)


def alternates(page_out):
    """hreflang：告訴搜尋引擎同一頁的各語言版本，避免被判定重複內容。"""
    out = []
    for l in LANGS:
        out.append('<link rel="alternate" hreflang="%s" href="%s%s%s">'
                   % (l['code'], SITE_URL, l['dir'], page_path(page_out)))
    out.append('<link rel="alternate" hreflang="x-default" href="%s%s">'
               % (SITE_URL, page_path(page_out)))
    return '\n'.join(out)


def apply_ui(text, ui):
    """把 {{UI:key}} 換成該語言的介面字串。缺字串就報錯，不要靜默留空。"""
    def sub(m):
        key = m.group(1)
        if key not in ui:
            raise SystemExit('ui.json 缺少字串：%s' % key)
        return ui[key]
    return re.sub(r'\{\{UI:([a-z0-9_]+)\}\}', sub, text)


def render(page, lang, layout, header, footer, ui):
    """組出單一頁面的完整 HTML。"""
    out = lang['dir'] + page['out']
    root = root_for(out)

    # 頁面內容：先找該語言的版本，沒有就用英文
    body = (read_or_none(SRC, 'pages', lang['code'], page['src'])
            or read(SRC, 'pages', page['src']))

    html = layout
    html = html.replace('{{HEADER}}', header)
    html = html.replace('{{FOOTER}}', footer)
    html = html.replace('{{BODY}}', body)
    html = apply_ui(html, ui)
    html = html.replace('{{LANGNAV}}', lang_nav(page['out'], root, lang['code']))
    html = html.replace('{{ALTERNATES}}', alternates(page['out']))
    html = html.replace('{{TITLE}}', page['title'])
    html = html.replace('{{DESC}}', page['desc'])
    html = html.replace('{{LANG}}', lang['code'])
    html = html.replace('{{BODYCLASS}}', page.get('bodyclass', ''))
    html = html.replace('{{PATH}}', lang['dir'] + page_path(page['out']))
    html = html.replace('{{BASE}}', root + lang['dir'])   # 站內頁面連結（含語言目錄）
    html = html.replace('{{ROOT}}', root)                 # 資產路徑（三語共用）
    html = html.replace('{{LANGDIR}}', lang['dir'])

    nav = page.get('nav')
    if nav:
        html = html.replace('data-nav="%s"' % nav, 'data-nav="%s" class="is-current"' % nav)

    leftover = re.findall(r'\{\{[A-Z_]+(?::[a-z0-9_]+)?\}\}', html)
    if leftover:
        raise SystemExit('未替換的樣板變數 %s（%s）' % (sorted(set(leftover)), out))
    return html


def pages_for(lang, base_pages):
    """套用該語言的標題與描述覆寫；沒有覆寫就用英文的。"""
    override = {}
    raw = read_or_none(SRC, 'content', 'pages.%s.json' % lang['code'])
    if raw:
        data = json.loads(raw)
        for item in data.get('pages', []):
            override[item['out']] = item

    result = []
    for p in base_pages:
        merged = dict(p)
        o = override.get(p['out'], {})
        for key in ('title', 'desc'):
            if o.get(key):
                merged[key] = o[key]
        result.append(merged)
    return result


def build_sitemap(all_outputs):
    urls = []
    for out in all_outputs:
        urls.append('  <url><loc>%s%s</loc></url>' % (SITE_URL, out))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + '\n'.join(urls) + '\n</urlset>\n')


def main():
    base_pages = json.loads(read(SRC, 'content', 'pages.en.json'))['pages']
    layout = read(SRC, 'layout.html')
    header = read(SRC, 'partials', 'header.html')
    footer = read(SRC, 'partials', 'footer.html')

    if '--clean' in sys.argv:
        for l in LANGS:
            if l['dir']:
                d = os.path.join(BASE, l['dir'].rstrip('/'))
                if os.path.isdir(d):
                    shutil.rmtree(d)
        for p in base_pages:
            d = p['out'].split('/')[0]
            if d != 'index.html' and os.path.isdir(os.path.join(BASE, d)):
                shutil.rmtree(os.path.join(BASE, d))

    sitemap_entries = []
    total = 0
    for l in LANGS:
        ui = json.loads(read(SRC, 'content', 'ui.%s.json' % l['code']))
        pages = pages_for(l, base_pages)
        translated = 0
        for p in pages:
            out = l['dir'] + p['out']
            write(os.path.join(BASE, out), render(p, l, layout, header, footer, ui))
            sitemap_entries.append(l['dir'] + page_path(p['out']))
            if os.path.exists(os.path.join(SRC, 'pages', l['code'], p['src'])):
                translated += 1
            total += 1
        if l['code'] == DEFAULT_LANG:
            note = ''
        elif translated == len(pages):
            note = '  （%d 頁全部已翻譯）' % translated
        else:
            note = '  （已翻譯 %d/%d 頁，其餘暫用英文）' % (translated, len(pages))
        print('  ✓ %-6s %2d 頁 → /%s%s' % (l['label'], len(pages), l['dir'], note))

    write(os.path.join(BASE, 'sitemap.xml'), build_sitemap(sitemap_entries))
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
    print('\n共 %d 頁產生完成，另含 sitemap.xml 與 robots.txt' % total)


if __name__ == '__main__':
    main()
