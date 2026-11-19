import re, json, gzip, base64, os, sys, html
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
s = open(src, encoding="utf-8").read()
blocks = {m.group(1): m.group(2) for m in re.finditer(r'<script type="__bundler/(\w+)"[^>]*>(.*?)</script>', s, re.S)}
manifest = json.loads(blocks["manifest"])
ext = json.loads(blocks["ext_resources"])
template = json.loads(blocks["template"])  # it's a JSON string literal
idmap = {e["uuid"]: e["id"] for e in ext}
ext_by_mime = {}
names = {}
for uuid, entry in manifest.items():
    data = base64.b64decode(entry["data"])
    if entry.get("compressed"): data = gzip.decompress(data)
    mime = entry["mime"]
    extmap = {"application/javascript":"js","text/javascript":"js","text/html":"html","font/woff2":"woff2","image/png":"png","image/webp":"webp","text/css":"css","image/jpeg":"jpg","image/svg+xml":"svg"}
    e = extmap.get(mime, "bin")
    label = idmap.get(uuid)
    if label:
        base = re.sub(r'[^A-Za-z0-9._-]+','_', label.split('/')[-1]) or uuid
        name = f"{base}" if base.endswith('.'+e) else f"{base}.{e}"
    else:
        name = f"{uuid}.{e}"
    names[uuid] = name
    open(os.path.join(out, name), "wb").write(data)
    print(f"{uuid} -> {name}  ({len(data)} bytes, {mime})")
# rewrite template refs to extracted names
t = template
for uuid, name in names.items():
    t = t.replace(uuid, name)
open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(t)
# pull out the x-dc source + props
m = re.search(r'<script type="text/x-dc"([^>]*)>(.*?)</script>', t, re.S)
if m:
    attrs = m.group(1)
    body = m.group(2)
    open(os.path.join(out, "app.dc.source.txt"), "w", encoding="utf-8").write(body)
    pm = re.search(r'data-props="([^"]*)"', attrs)
    if pm:
        props = html.unescape(pm.group(1))
        open(os.path.join(out, "app.props.json"), "w", encoding="utf-8").write(props)
    print("x-dc source chars:", len(body), "lines:", body.count("\n"))
print("index.html chars:", len(t))
