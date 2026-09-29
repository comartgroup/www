# -*- coding: utf-8 -*-
"""Render the equipment tables from src/content/equipment.json into the three equipment pages.

Replaces whatever sits between the EQ:START / EQ:END markers. Re-runnable.
"""
import json, io, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = {
  'en': ('src/pages/equipment.html',       {'eq':'Equipment','mdl':'Model','loc':'Location','qty':'Qty','units':'units'}),
  'zh': ('src/pages/zh-TW/equipment.html', {'eq':'設備','mdl':'規格／型號','loc':'位置','qty':'數量','units':'台／件'}),
  'vi': ('src/pages/vi/equipment.html',    {'eq':'Thiết bị','mdl':'Quy cách / Model','loc':'Vị trí','qty':'SL','units':'đơn vị'}),
}
START, END = '<!-- EQ:START -->', '<!-- EQ:END -->'

def esc(s):
    return (str(s).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;'))

def slug(key):
    return 'eq-' + re.sub(r'[^a-z0-9]+','-', key.lower()).strip('-') or 'eq'

def render(data, lang, L):
    ids = {g['key']: 'eq-%d' % i for i, g in enumerate(data['groups'], 1)}
    out = [START]
    out.append('    <div class="eqnav reveal">')
    for g in data['groups']:
        out.append('      <a href="#%s">%s</a>' % (ids[g['key']], esc(g['title'][lang])))
    out.append('    </div>')
    for g in data['groups']:
        out.append('')
        out.append('      <div class="eqgroup reveal" id="%s">' % ids[g['key']])
        out.append('        <div class="eqgroup__head">')
        out.append('          <h3>%s</h3>' % esc(g['title'][lang]))
        out.append('          <span class="eqgroup__count">%d %s</span>' % (g['units'], L['units']))
        out.append('        </div>')
        out.append('        <table class="eqtable">')
        out.append('          <thead><tr><th>%s</th><th>%s</th><th>%s</th><th>%s</th></tr></thead>'
                   % (L['eq'], L['mdl'], L['loc'], L['qty']))
        out.append('          <tbody>')
        for r in g['rows']:
            out.append('          <tr><td>%s</td><td class="mdl">%s</td><td class="loc">%s</td><td class="qty">%d</td></tr>'
                       % (esc(r['name'][lang]), esc(r['spec']), esc(r['loc'][lang]), r['qty']))
        out.append('          </tbody>')
        out.append('        </table>')
        out.append('      </div>')
    out.append('    ' + END)
    return '\n'.join(out)

def main():
    data = json.load(io.open(os.path.join(ROOT,'src/content/equipment.json'), encoding='utf-8'))
    for lang, (path, L) in PAGES.items():
        p = os.path.join(ROOT, path)
        s = io.open(p, encoding='utf-8').read()
        if START not in s or END not in s:
            print('!! markers missing in %s — add %s / %s around the tables' % (path, START, END)); sys.exit(1)
        new = re.sub(re.escape(START) + r'.*?' + re.escape(END), lambda m: render(data, lang, L), s, flags=re.S)
        io.open(p,'w',encoding='utf-8').write(new)
        print('  ✓ %-34s %d groups, %d units' % (path.split('/')[-2] + '/' + path.split('/')[-1],
              len(data['groups']), data['summary']['total_units']))

if __name__ == '__main__':
    main()
