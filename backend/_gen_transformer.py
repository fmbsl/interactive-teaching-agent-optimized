"""把 _transformer.py 转成 sceneCode,生成独立测试 HTML。"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from skill.py2ts_adapter import python_to_scene_code

py = open("_alexnet.py", encoding="utf-8").read()
# 提取 class 体
import re
m = re.search(r"class \w+\(ThreeDScene\):\s*\n((?: .+\n)+)", py)
body_lines = []
in_construct = False
for ln in py.split("\n"):
    if "def construct" in ln:
        in_construct = True
        continue
    if in_construct:
        if ln.startswith(" ") or ln.strip() == "":
            body_lines.append(ln[8:] if ln.startswith("        ") else ln)
        else:
            break
construct_body = "\n".join(body_lines)
full_py = "from manim import *\nclass XScene(ThreeDScene):\n    def construct(self):\n" + "\n".join("        " + l for l in body_lines if l.strip())

code = python_to_scene_code(full_py)
print("===== sceneCode =====")
print(code)
print("===== len:", len(code), "=====")

html = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Transformer 3D</title>
<style>html,body{{margin:0;height:100%;background:#0a0c14;}}#c{{width:100%;height:100%;}}</style>
</head><body><div id="c"></div>
<script type="module">
import * as MW from "https://cdn.jsdelivr.net/npm/manim-web@0.3.24/dist/manim-web.browser.js";
const container = document.getElementById('c');
const Scene = MW.ThreeDScene;
const s = new Scene(container, {{ backgroundColor: '#0a0c14', width: window.innerWidth, height: window.innerHeight }});
const params = {{}};
const ctx = {{ ...MW, matMul: (a,b)=>{{const iv=(x)=>!Array.isArray(x[0]);if(iv(b)){{const M=a,v=b;return M.map(r=>r.reduce((s,m,i)=>s+m*v[i],0));}}const M=a,N=b;return M.map(r=>N[0].map((_,j)=>r.reduce((s,m,i)=>s+m*N[i][j],0)));}}, scene: s, params }};
const AsyncFunction = Object.getPrototypeOf(async function(){{}}).constructor;
const fn = new AsyncFunction("ctx", {json.dumps(code)});
fn(ctx).catch(e => console.error('EXEC FAIL:', e.message, e.stack));
</script></body></html>"""
open("_transformer.html", "w", encoding="utf-8").write(html)
print("wrote _transformer.html")
