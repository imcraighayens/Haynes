const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const [,, dir, file, out, w, h] = process.argv;
const types = {html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2',png:'image/png',webp:'image/webp',json:'application/json'};
const srv = http.createServer((req,res)=>{ const p = decodeURIComponent(req.url.split('?')[0]); let f = path.join(dir, p==='/'?file:p); if(!fs.existsSync(f)){res.writeHead(404);return res.end('nf '+p);} const ext=f.split('.').pop(); res.writeHead(200,{'content-type':types[ext]||'application/octet-stream'}); fs.createReadStream(f).pipe(res); });
srv.listen(0, async ()=>{ const port = srv.address().port; const browser = await chromium.launch(); const page = await browser.newPage({viewport:{width:+w||1440,height:+h||900}}); const logs=[]; page.on('console', m=>{ if(['error','warning'].includes(m.type())) logs.push(m.type()+': '+m.text().slice(0,300)); }); page.on('pageerror', e=>logs.push('pageerror: '+String(e).slice(0,300))); page.on('requestfailed', r=>logs.push('reqfail: '+r.url().slice(-80)));
  await page.goto('http://127.0.0.1:'+port+'/', {waitUntil:'load'}); await page.waitForTimeout(6000);
  const info = await page.evaluate(()=>({title:document.title, bodyChars:document.body.innerText.length, text:document.body.innerText.slice(0,400).replace(/\s+/g,' '), hasErr:!!document.getElementById('__bundler_err'), errText:(document.getElementById('__bundler_err')||{}).textContent||''}));
  await page.screenshot({path: out, fullPage:false}); console.log(JSON.stringify({info, logs: logs.slice(0,15)}, null, 1)); await browser.close(); srv.close(); });
