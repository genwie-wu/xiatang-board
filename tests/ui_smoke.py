"""畫面冒煙測試：用假的 Firebase（tests/mock）在本機開網站，截圖到 tests/out/。
用法：python3 tests/ui_smoke.py <使用者> <頁面,頁面> <desktop|mobile>
  使用者：u1 管理者、u2 夏躺人員（曼達）、u3 播客煮、u4 待開通
  例：python3 tests/ui_smoke.py u1 home,schedule,income,payroll,admin,deal/d1 desktop
"""
import json, sys, threading, http.server, functools, os, pathlib
ROOT=pathlib.Path(__file__).resolve().parent
from playwright.sync_api import sync_playwright
SITE=str(ROOT.parent/'public')
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',8765), functools.partial(Q, directory=SITE))
threading.Thread(target=srv.serve_forever, daemon=True).start()

seed = {
 'users': {'u1': {'email':'genwie@gmail.com','name':'吳浚瑋','role':'admin','photoURL':''},
           'u2': {'email':'manda@example.com','name':'曼達','role':'xiatang'},
           'u3': {'email':'bz@example.com','name':'播客煮小編','role':'bokezhu'}},
 'deals': {
   'd1': {'brand':'好眠床墊','briefUrl':'https://drive.google.com/x','quote':60000,'stories':3,'otherSocial':'短影音 1 支','note':'客戶希望提到試躺 100 天',
          'episodes':[{'id':'e1','airDate':'2026-09-16','minutes':'1.5','scriptDue':'2026-09-09','roughCutDue':'2026-09-12','infoText':'好眠床墊 官網 https://example.com\n折扣碼 XIATANG'},
                      {'id':'e2','airDate':'2026-10-14','minutes':'1','scriptDue':'2026-10-07','roughCutDue':'2026-10-10','infoText':''}]},
   'd2': {'brand':'晨光咖啡','briefUrl':'https://drive.google.com/y','quote':30000,'stories':2,'otherSocial':'','note':'',
          'episodes':[{'id':'e3','airDate':'2026-09-30','minutes':'2','scriptDue':'2026-09-23','roughCutDue':'2026-09-26','infoText':'晨光咖啡'}]},
   'd3': {'brand':'Aero 耳機','briefUrl':'https://drive.google.com/z','quote':45000,'stories':0,'otherSocial':'','note':'',
          'episodes':[{'id':'e4','airDate':'2026-10-28','minutes':'1.5','scriptDue':'2026-10-21','roughCutDue':'2026-10-24','infoText':''}]},
 },
 'payments': {'d1': {'paid':True,'paidDate':'2026-09-25','invoiced':True,'invoiceDate':'2026-09-20','invoiceNo':'AB12345678'}, 'd2': {'invoiced':True,'invoiceDate':'2026-10-02'}},
 'notifications': {'n1': {'uid':'u1','title':'新業配：Aero 耳機','body':'1 集，首集 10/28 上線','link':'#deal/d3','read':False,'createdAt':{'__ts':0}}, 'n2': {'uid':'u2','title':'x','read':False}},
 'expenses': {'x1': {'date':'2026-09-10','item':'外發拍攝','payee':'阿明','amount':6000}},
}
who = sys.argv[1] if len(sys.argv)>1 else 'u1'
users = {'u1':('genwie@gmail.com','吳浚瑋'),'u2':('manda@example.com','曼達'),'u3':('bz@example.com','播客煮小編'),'u4':('new@example.com','新朋友')}
mu = {'uid':who,'email':users[who][0],'displayName':users[who][1],'photoURL':''}
pages = sys.argv[2].split(',') if len(sys.argv)>2 else ['home']
vp = sys.argv[3] if len(sys.argv)>3 else 'desktop'
(ROOT/'out').mkdir(exist_ok=True)
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':1200,'height':900} if vp=='desktop' else {'width':390,'height':844}, device_scale_factor=1, locale='zh-TW', timezone_id='Asia/Taipei')
    ctx.add_init_script(f"window.__store={json.dumps(seed, ensure_ascii=False)}; window.__mockUser={json.dumps(mu)}; window.__loginAs=window.__mockUser;")
    def route(r):
        u=r.request.url
        if 'gstatic.com/firebasejs' in u:
            name=u.split('/')[-1]
            r.fulfill(path=str(ROOT/'mock'/name), content_type='application/javascript'); return
        if '127.0.0.1' in u: r.continue_(); return
        r.abort()
    ctx.route('**/*', route)
    pg=ctx.new_page()
    errs=[]
    pg.on('console', lambda m: errs.append(m.type+': '+m.text) if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    for name in pages:
        pg.goto('http://127.0.0.1:8765/#'+name if name!='-' else 'http://127.0.0.1:8765/')
        pg.wait_for_timeout(600)
        pg.screenshot(path=str(ROOT/'out')+f'/shot-{who}-{name.replace("/","_")}-{vp}.png', full_page=True)
    print('\n'.join(e for e in errs if 'ERR_FAILED' not in e and 'net::' not in e))
    b.close()
