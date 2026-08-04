#!/usr/bin/env python3
# encoding: utf-8
"""把 maloyan/manim-web 官方 example(tools/demo/_mw_exs/*.ts)转成
src/templates/official.ts —— **v3 自由脚本模式**。

与 v2 不同:v3 尽量保留官方"原样"(自带整套厨房),而不是拆成 ctx 函数体:
  - 剥掉 `import ... from '...'`(manim-web 导出已由运行时铺到全局);
  - 剥掉按钮/embed/重置样板(playBtn/resetBtn/isAnimating/MutationObserver 等)——
    因为运行环境没有这些 DOM/事件;
  - 保留 `const container = document.getElementById('container')`(运行时给出真 #container div);
  - 保留 `const scene = new Scene/ThreeDScene(container, {...相机选项})` —— 相机/3D/PiP 配置全保留;
  - 保留顶层 helper/consts/数据(多行数组等整段保留);
  - TS 注解保留(运行时 ts.transpileModule 剥);
  - 末尾自动调用其场景函数(而不是靠 click)。

这样官方 example 几乎原样能跑,相机/3D/数据/TS 都不再是障碍。
"""
import io, os, re, json

SRC_DIR = r"D:\Claude\Manim\tools\demo\_mw_exs"
OUT = r"D:\Claude\Manim\.claude\worktrees\hungry-aryabhata-df9f3a\src\templates\official.ts"

BOIL = re.compile(r"playBtn|resetBtn|isAnimating|MutationObserver|querySelectorAll|URLSearchParams|\.disabled\b|\.style\.cssText|\.attributes\b|attachEvent|['\"]embed['\"]", re.I)
UI_BTN = re.compile(r"document\.getElementById\(\s*['\"](?:playBtn|resetBtn)['\"]")
HAS_OWN_SCENE = re.compile(r"new\s+(?:Scene|ThreeDScene)\s*\(")

def strip_imports(text):
    """去掉所有 `import ... ;`(跨行)与孤立 `export`。"""
    s = re.sub(r"\bimport\s+[^;]*;?", "", text, flags=re.S)
    s = re.sub(r"^[ \t]*export\s+(?=(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class)\b)", "", s, flags=re.M)
    s = re.sub(r"^[ \t]*export\s+default\s+", "", s, flags=re.M)
    return s

def harness_start(s):
    """返回第一个"demo 壳"标记(按钮/状态/embed)的起始下标;无则 len(s)。
    保留前面的:顶层 const + 自建 scene + 场景函数。"""
    cands = []
    pats = [r"getElementById\(\s*['\"]playBtn", r"addEventListener\(", r"let isAnimating",
            r"MutationObserver", r"URLSearchParams", r"getElementById\(\s*['\"]resetBtn"]
    for p in pats:
        m = re.search(p, s)
        cands.append(m.start() if m else len(s))
    return min(cands)


def brace_body(text, open_idx):
    depth = 0; i = open_idx
    while i < len(text):
        c = text[i]
        if c == "{": depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0: return text[open_idx+1:i]
        i += 1
    return None

def find_scene_fn(text):
    """找 `(?:async )?function NAME(scene...){` 的名字(动画场景函数)。"""
    m = re.search(r"(?:async\s+|export\s+async\s+)?function\s+(\w+)\s*\(\s*scene(?:\s*:\s*[^,)\s]+)?\s*(?:[),])", text)
    return m.group(1) if m else None

def click_body(text):
    """找 `addEventListener('click', async () => { BODY })`,返回 BODY(无则 None)。"""
    m = re.search(r"addEventListener\(\s*['\"]click['\"]\s*,\s*async\s*(?:\(\s*\))?\s*=>\s*\{", text)
    if not m: return None
    return brace_body(text, text.index("{", m.start()))

def _click_listen_re(field):
    return (r"document\.getElementById\(\s*['\"]%s['\"]\)(?:\s*as\s+\w+)?\s*\.addEventListener\(\s*['\"]click['\"]\s*,\s*async\s*(?:\(\s*\))?\s*=>\s*\{" % field)


def _stateme_end_after_brace(s, brace_end_idx):
    """'}' 之后消费 ');' 返回语句末尾。"""
    j = brace_end_idx + 1
    if s[j:j+1] == ")":
        j += 1
    rest = s[j:]
    k = rest.find(";")
    return j + k + 1 if k != -1 else j


def brace_end(text, open_idx):
    depth = 0; i = open_idx
    while i < len(text):
        c = text[i]
        if c == "{": depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0: return i
        i += 1
    return None


def replace_statement(s, m, new):
    """把匹配 m(指向一条 addEventListener 语句起点)的整条语句替换为 new。"""
    line_start = s.rfind("\n", 0, m.start()) + 1
    oi = s.index("{", m.start())
    end_brace = brace_end(s, oi)
    end = _stateme_end_after_brace(s, end_brace)
    return s[:line_start] + new + s[end:]


def runnable(text):
    """把剥了 import 的源码接上"直接运行"的尾巴,并丢弃 demo 壳(按钮/embed/状态)。
    策略:不截断(保留全部 helper/consts/scene 声明,它们在文件任意位置都定义好了),
    只移除/改写"壳语句"(playBtn/resetBtn 的 addEventListener、embed 块、isAnimating 赋值),
    然后自动运行。这样 helper 定义(如 setAnimating/getRectangleCorners)不会被扔掉。"""
    s = text
    fn = find_scene_fn(s)
    # 1) 移除 resetBtn 的 click 监听语句
    for field in ("resetBtn",):
        m = re.search(_click_listen_re(field), s)
        if m:
            line_start = s.rfind("\n", 0, m.start()) + 1
            oi = s.index("{", m.start())
            end = _stateme_end_after_brace(s, brace_end(s, oi))
            s = s[:line_start] + s[end:]
    # 2) playBtn 的 click 监听:A 型删掉(末尾自动调函数的尾巴,不靠 click);B 型换成它的 body
    pm = re.search(_click_listen_re("playBtn"), s)
    if pm:
        body = click_body(s) if not fn else None
        if fn:
            s = replace_statement(s, pm, "")
        elif body is not None:
            s = replace_statement(s, pm, "\n" + body + "\n")
    # 3) 移除 embed 块(if (new URLSearchParams...) { ... } 平衡花括号)与 isAnimating 赋值/状态行
    em = re.search(r"if\s*\(\s*new\s+URLSearchParams", s)
    if em:
        eoi = s.index("{", em.start())
        eend = brace_end(s, eoi)
        if eend is not None:
            lstart = s.rfind("\n", 0, em.start()) + 1
            s = s[:lstart] + s[eend+1:]
    s = re.sub(r"^\s*let\s+isAnimating\s*=\s*\w+\s*;\s*$", "", s, flags=re.M)
    s = re.sub(r"^\s*isAnimating\s*=\s*\w+\s*;\s*$", "", s, flags=re.M)
    s = re.sub(r"^\s*if\s*\(\s*isAnimating\s*\)\s*return\s*;\s*$", "", s, flags=re.M)
    # 4) 任何 `document.getElementById('非container')`(演示按钮/progress/status 等)换 no-op:
    #    运行时没有这些 DOM,getElementById 返回 null → 后续 .addEventListener/.disabled 等会炸。
    #    保留 'container'(我们真给了 #container)。
    STUB = "({ setAttribute(){}, removeAttribute(){}, addEventListener(){}, click(){}, style:{}, disabled:false, textContent:\"\", value:0 })"
    def _stubit(m):
        return STUB if m.group(1) != "container" else m.group(0)
    s = re.sub(r"document\.getElementById\(\s*['\"]([^'\"]+)['\"]\)(?:\s*as\s+\w+)?", _stubit, s)
    # 5) 自动运行
    head = s.rstrip()
    if fn:
        return head + "\n\nawait %s(scene);\n" % fn
    return head + "\n"


templates, skipped = [], []
for fn in sorted(f for f in os.listdir(SRC_DIR) if f.endswith(".ts") and not f.startswith("_")):
    p = os.path.join(SRC_DIR, fn)
    raw = io.open(p, encoding="utf-8").read()
    s = strip_imports(raw)
    if not HAS_OWN_SCENE.search(s):
        skipped.append(fn + " : 未自建 Scene"); continue
    run = runnable(s)
    if not run or run.isspace():
        skipped.append(fn + " : 生成空脚本"); continue
    name = re.sub(r"\.ts$", "", fn)
    title = re.sub(r"(?<!^)(?=[A-Z])", " ", name).replace("_", " ").replace("-", " ").title()
    templates.append({
        "id": "official-" + name,
        "title": title,
        "intent": "官方 manim-web 示例(自建 scene/相机,TS 转译后运行;保留官方演示色)",
        "domain": "demo",
        "category": "演示",
        "sceneCode": run,
    })

lines = []
lines.append("// ==========================================================")
lines.append("// 自动生成:tools/gen_official_templates.py v3(自由脚本,官方原样)")
lines.append("// 运行时见 src/runScript.ts + src/manimCtx.exposeManimGlobals(container)。")
lines.append("// 重生成:python tools/gen_official_templates.py")
lines.append("// ==========================================================")
lines.append("import type { Template } from \"./library\";")
lines.append("")
lines.append("export const OFFICIAL_TEMPLATES: Template[] = [")
for i, t in enumerate(templates):
    last = "," if i < len(templates) - 1 else ""
    lines.append("  { id: %r, title: %r, intent: %r, domain: \"demo\", category: \"演示\", sceneCode: %r }%s"
                 % (t["id"], t["title"], t["intent"], t["sceneCode"], last))
lines.append("];")
io.open(OUT, "w", encoding="utf-8").write("\n".join(lines))
print("generated", len(templates), "official self-build templates ->", OUT)
if skipped:
    print("SKIPPED(%d):" % len(skipped)); [print("  ", s) for s in skipped]