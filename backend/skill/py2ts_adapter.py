"""py2ts 适配器:Python Manim 代码 → 前端可执行的 JS 函数体。

流程:
1. 用 python 跑 tools/py2ts.py(AST 转换器)把 Python Manim 转成 TS。
2. 解析 TS 输出:提取 import 的标识符列表 + 函数体(剥 import/export/类型注解)。
3. 拼成前端 AsyncFunction 可执行的函数体:
   `const { <imports...> } = ctx; <body>`
   前端 ctx 注入 manim-web 全部导出 + scene + params,故 import 的任何标识符都能解构到。

注意:py2ts 输出是 TS(带 `: Scene` 类型注解),AsyncFunction 只认 JS。
我们只取函数体,函数体内的类型注解(py2ts 基本不在 body 里加注解)需手工剥;
目前 py2ts 的 body 是纯 JS 语法(变量声明/方法调用),无类型注解,可直接执行。
"""
from __future__ import annotations
import os
import re
import subprocess
import sys
import json
from typing import Optional

# tools/py2ts.py 相对项目根目录(AST 转换器;旧 py2ts.cjs 保留在 tools/ 作备份)
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_PY2TS = os.path.join(_ROOT, "tools", "py2ts.py")


def _run_py2ts(python_code: str) -> str:
    """调 python 跑 tools/py2ts.py(AST 转换器),stdin 喂 Python 代码,返回转换后的 TS。

    退出码:0=成功;2=成功但有警告(输出仍写出);1=解析/IO 错。
    Windows 子进程默认 GBK stdout,转换器有警告时往 stdout 写 ⚠ 会崩
    UnicodeEncodeError,故强制 PYTHONIOENCODING=utf-8 / PYTHONUTF8=1。
    """
    if not os.path.exists(_PY2TS):
        raise RuntimeError(f"py2ts.py 不存在:{_PY2TS}")
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    try:
        proc = subprocess.run(
            [sys.executable, _PY2TS],
            input=python_code,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            cwd=_ROOT,
            env=env,
        )
    except FileNotFoundError:
        raise RuntimeError("未找到 python 解释器,无法运行 py2ts 转换")
    if proc.returncode not in (0, 2):
        raise RuntimeError(f"py2ts 转换失败(returncode={proc.returncode}):{proc.stderr.strip()[:500]}")
    if proc.returncode == 2 and proc.stderr.strip():
        # 2 = 成功+警告;警告不阻断,记日志便于排查(try/except 类型匹配、with/zip 等已知项)
        from .debug_log import dlog
        dlog(f"py2ts 警告:\n{proc.stderr.strip()[:800]}")
    return proc.stdout


def _parse_ts_output(ts: str) -> tuple[list[str], str]:
    """从 py2ts 的 TS 输出里提取 import 标识符列表 + 函数体。

    py2ts 输出形如:
      // comments
      import {
        A, B, C
      } from '../src/index.ts';

      export async function name(scene: Scene) {
        <body>
      }

    返回 (["A","B","C",...], "<body>"),body 为去掉外层 function 包裹的函数体。
    """
    # 提取 import 块里的标识符
    m_import = re.search(r"import\s*\{([^}]*)\}\s*from\s*['\"][^'\"]+['\"]", ts, re.S)
    imports: list[str] = []
    if m_import:
        raw = m_import.group(1)
        # 按逗号拆,去掉 type-only 导入(type X)和空白
        for part in raw.split(","):
            part = part.strip()
            if not part:
                continue
            # 去掉 "type X" 形式
            part = re.sub(r"^type\s+", "", part)
            # 只取标识符(去掉别名 as 之类,py2ts 不产生别名)
            ident = part.split()[0] if part else ""
            if ident and re.match(r"^[A-Za-z_$][\w$]*$", ident):
                imports.append(ident)

    # 提取函数体:export async function name(scene: Scene) { ... }
    # 用花括号匹配取最外层 body
    m_fn = re.search(r"export\s+async\s+function\s+\w+\s*\([^)]*\)\s*\{", ts)
    body = ""
    if m_fn:
        start = m_fn.end()  # 第一个 { 之后
        depth = 1
        i = start
        while i < len(ts) and depth > 0:
            ch = ts[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        body = ts[start:i]
    else:
        # 兜底:去掉 import 块和注释,剩下全当 body
        body = re.sub(r"^//.*$", "", ts, flags=re.M)
        body = re.sub(r"import\s*\{[^}]*\}\s*from\s*['\"][^'\"]+['\"]\s*;?", "", body, flags=re.S)
        body = re.sub(r"export\s+async\s+function\s+\w+\s*\([^)]*\)\s*\{", "", body)
        body = body.rstrip("}")

    return imports, body.strip()


def _post_process_body(body: str) -> str:
    """修转换器遗留的输出问题。

    新的 AST 转换器(py2ts.py)已正确处理大部分:行内 # 注释、font->fontFamily、
    rate_func、get_start/get_end、str/int/float、** 幂、1. 浮点字面量、元组解包、
    @ 矩阵乘法、set_camera_orientation 位置参数、add_fixed_in_frame_mobjects 等。
    故下面多数 regex 对新转换器输出是幂等 no-op(不匹配),保留作防御:若 LLM 写了
    转换器未覆盖的残留(如 rate_functions.xxx、裸 np.、Python round(x,n)),仍能兜住。
    实测对新转换器正确输出无破坏(每条 regex 均不命中)。
    """
    lines = []
    for ln in body.split("\n"):
        # 剥掉残留的 Python import 行(py2ts 只跳过 manim/numpy,import math 等会残留,
        # 前端 new AsyncFunction 遇到 import 会报 "Cannot use import statement outside a module")
        st = ln.strip()
        if st.startswith("import ") or st.startswith("from ") and " import" in st:
            continue
        # 转行内 # 注释(忽略字符串内的 #;LaTeX 串里基本无 #)
        # 简单找第一个不在引号内的 #
        in_s = False
        sc = ""
        new = ""
        i = 0
        while i < len(ln):
            ch = ln[i]
            if ch in ('"', "'", "`"):
                in_s = not in_s
                new += ch
            elif ch == "#" and not in_s:
                new += "//" + ln[i + 1:]
                break
            else:
                new += ch
            i += 1
        lines.append(new)
    body = "\n".join(lines)
    # font: → fontFamily:(仅在 Text 构造/选项里;manim-web Text 选项是 fontFamily)
    body = re.sub(r"\bfont:\s*", "fontFamily: ", body)
    # rate_functions.ease_in_out_sine / ease_in / ease_out → easeInOut / easeIn / easeOut
    body = re.sub(r"\brate_functions\.ease_in_out_\w+", "easeInOut", body)
    body = re.sub(r"\brate_functions\.ease_in\b", "easeIn", body)
    body = re.sub(r"\brate_functions\.ease_out\b", "easeOut", body)
    body = re.sub(r"\brate_functions\.smooth\b", "smooth", body)
    body = re.sub(r"\brate_functions\.linear\b", "linear", body)
    # Python 内建 → JS: str()→String(), int()→parseInt(), float()→parseFloat()
    body = re.sub(r"\bstr\(", "String(", body)
    body = re.sub(r"\bint\(", "parseInt(", body)
    body = re.sub(r"\bfloat\(", "parseFloat(", body)
    # np.round(x, n) → Math.round(x * 10^n) / 10^n(简单两参数情形)
    # np.round 等 np.* 由前端 ctx 的 np polyfill 处理,不再在此重写
    # np.array/np.asarray → 直接留数组字面量(py2ts 已处理 np.array(...),兜底)
    # math.radians(d) → d * Math.PI/180 ; math.degrees(r) → r * 180/Math.PI
    body = re.sub(r"\bmath\.radians\(([^)]+)\)", r"((\1) * Math.PI / 180)", body)
    body = re.sub(r"\bmath\.degrees\(([^)]+)\)", r"((\1) * 180 / Math.PI)", body)
    # math.pow/sin/cos/... py2ts 已转 Math.*;兜底 math. → Math.
    body = re.sub(r"\bmath\.", "Math.", body)
    # 修双重转换 Math.Math.X → Math.X(py2ts 转一次 + 上面 math.→Math. 可能叠加)
    body = re.sub(r"\bMath\.Math\.", "Math.", body)
    # 残留的 np. 前缀(未识别的 numpy 调用)→ 去掉 np.,尽量让 Math.* 兜着
    # np.* 保留(前端 ctx 注入 np polyfill: sin/cos/sqrt/exp/log/pi/array/arange/linspace/zeros/linalg 等)
    body = re.sub(r"\bMath\.Math\.", "Math.", body)  # np.→Math. 后再防一次双重
    # Math.pi / Math.e 等小写常量 → 大写(JS 是 Math.PI / Math.E)
    body = re.sub(r"\bMath\.pi\b", "Math.PI", body)
    body = re.sub(r"\bMath\.e\b", "Math.E", body)
    body = re.sub(r"\bMath\.tau\b", "(2 * Math.PI)", body)
    # Python round(x, n) → Math.round(x * 10^n) / 10^n(py2ts 不转 round)
    # round(x, n) / round(x) 已由 py2ts.py emit_round 正确转换;不再在此补
    # (否则对 py2ts 产出的 Math.round(...) 二次匹配 -> Math.(Math.round(...)) 语法错)
    # Python 浮点字面量 "1." → "1.0"(JS 不认 "1." 作为数字)
    body = re.sub(r"(?<![\w.])\d+\.(?![\w.])", lambda m: m.group(0) + "0", body)
    # Python 元组解包赋值 `a, b = c, d` → `const a = c, b = d`(py2ts 不转,JS 不支持)
    # 仅处理行首两标识符 = 两表达式的简单情形
    body = re.sub(
        r"(?m)^(\s*)([A-Za-z_$][\w$]*),\s*([A-Za-z_$][\w$]*)\s*=\s*([^,]+?),\s*(.+?);?\s*$",
        r"\1const \2 = \4, \3 = \5;",
        body,
    )
    # 矩阵乘法运算符 @ → matMul(A, B)(JS 不支持 @,py2ts 不转)
    # 匹配 "标识符 @ 标识符"(含下标/属性),用空格分隔的形式
    body = re.sub(r"([A-Za-z_$][\w$]*(?:\[[^\]]*\])*)\s*@\s*([A-Za-z_$][\w$]*(?:\[[^\]]*\])*)", r"matMul(\1, \2)", body)
    # 3D: set_camera_orientation(phi=X, theta=Y) → scene.setCameraOrientation(X, Y)
    # py2ts 把 self.set_camera_orientation 转成 set_camera_orientation(phi: X, theta: Y),
    # 带命名参数标签(JS 里 phi: 是标签语句,语义错)。去掉标签转位置参数。
    body = re.sub(
        r"\bset_camera_orientation\(\s*phi\s*:\s*([^,]+),\s*theta\s*:\s*([^)]+)\)",
        r"scene.setCameraOrientation(\1, \2)",
        body,
    )
    body = re.sub(r"\bset_camera_orientation\b", "scene.setCameraOrientation", body)
    # 修 setCameraOrientation 第三参数 { distance: N } → N(manim-web setCameraOrientation(phi,theta,distance) 第三参数是数字,py2ts 把命名参数 distance=N 转成对象)
    body = re.sub(r"(setCameraOrientation\([^,]+,\s*[^,]+,\s*)\{\s*distance:\s*([^}]+)\s*\}", r"\1\2", body)
    # 3D: add_fixed_in_frame_mobjects(x) → scene.addFixedInFrameMobjects(x)
    body = re.sub(r"\badd_fixed_in_frame_mobjects\(", "scene.addFixedInFrameMobjects(", body)
    # 3D: ParametricSurface/Surface3D 的 new 由 py2ts.cjs 负责(类实例化正则会加 new),
    # 适配层不再补(否则 py2ts 已加 new 后又被加一次 → new new X)。py2ts 另有 new new→new 清理兜底。
    # manim-web 方法名:Arrow/Line/Angle 用 getStart()/getEnd(),Arc 才用 getStartPoint()/getEndPoint()。
    # py2ts 把 get_start/get_end 一律映射成 getStartPoint/getEndPoint——对 Arrow/Line 错(更常见)。
    # 统一改成 getStart/getEnd(Arc 场景少见,以后单独处理)。
    body = re.sub(r"\.getEndPoint\b", ".getEnd", body)
    body = re.sub(r"\.getStartPoint\b", ".getStart", body)
    # Polygon:py2ts.cjs 已在 convertConstructorArgs 里把位置参数顶点转成 {vertices:[...]}(需Pythonts 修复)
    # 适配层 _fix_polygon_calls 不再调用(py2ts 已转对,重复处理可能出错)
    # Python 元组字面量在数组里 → JS 嵌套数组:[(a,b), (c,d)] → [[a,b], [c,d]]
    # 只转紧跟 [ 或 , 后的 (...) ,避免误伤函数调用的括号
    # (?!\s*=>) 排除箭头函数参数（如 Array.from(..., (_, i) => i) 的 (_, i)），否则误转成 [_, i] 语法错
    body = re.sub(r"([\[,])\s*\(([^()]+)\)(?!\s*=>)", r"\1[\2]", body)
    # 去掉 py2ts 的 /* animate */ 残留
    body = body.replace(" /* animate */ ", " ")
    return body


def _fix_polygon_calls(body: str) -> str:
    """把 `new Polygon(p1, p2, ..., {opts})` 转成 `new Polygon({ vertices: [p1,p2,...], ...opts })`。
    Python Manim 的 Polygon 接位置参数顶点,manim-web 只认 {vertices: [...]} 选项。py2ts 不转。"""
    out = []
    i = 0
    while i < len(body):
        m = re.search(r"new\s+Polygon\s*\(", body[i:])
        if not m:
            out.append(body[i:])
            break
        start = i + m.start()
        paren_open = i + m.end() - 1
        close = _find_matching_paren(body, paren_open)
        if close == -1:
            out.append(body[i:])
            break
        # 输出 new Polygon( 之前的内容
        out.append(body[i:start])
        args_str = body[paren_open + 1 : close]
        parts = _smart_split(args_str)
        positional = []
        opts = None
        for p in parts:
            ps = p.strip()
            if ps.startswith("{") and ps.endswith("}"):
                opts = ps  # 最后一个对象字面量是选项
            else:
                positional.append(ps)
        if positional:
            verts = "[" + ", ".join(positional) + "]"
            if opts:
                # 把 vertices 插入选项对象开头
                inner = opts[1:-1].strip()
                new_args = "{ vertices: " + verts + (", " + inner if inner else "") + " }"
            else:
                new_args = "{ vertices: " + verts + " }"
            out.append("new Polygon(" + new_args + ")")
        else:
            out.append(body[start : close + 1])
        i = close + 1
    return "".join(out)


def _find_matching_paren(s: str, open_idx: int) -> int:
    """给定 s[open_idx]=='(',返回匹配的 ')' 索引;不匹配返回 -1。"""
    depth = 0
    in_str = False
    str_ch = ""
    i = open_idx
    while i < len(s):
        ch = s[i]
        if in_str:
            if ch == str_ch and s[i - 1] != "\\":
                in_str = False
            i += 1
            continue
        if ch in ('"', "'", "`"):
            in_str = True
            str_ch = ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _smart_split(s: str) -> list:
    """按顶层逗号拆分(尊重括号/字符串嵌套)。"""
    parts = []
    depth = 0
    cur = ""
    in_str = False
    str_ch = ""
    for ch in s:
        if in_str:
            cur += ch
            if ch == str_ch:
                in_str = False
            continue
        if ch in ('"', "'", "`"):
            in_str = True
            str_ch = ch
            cur += ch
            continue
        if ch in "([{":
            depth += 1
            cur += ch
            continue
        if ch in ")]}":
            depth -= 1
            cur += ch
            continue
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
            continue
        cur += ch
    if cur.strip():
        parts.append(cur)
    return parts


def python_to_scene_code(python_code: str) -> str:
    """Python Manim 代码 → 前端可执行 JS 函数体字符串。

    返回的字符串可被前端 `new AsyncFunction("ctx", code)` 执行,
    code 开头 `const { ...imports } = ctx;` 解构出 manim-web 类/常量/工具函数,
    随后是转换后的场景逻辑(scene/play/add 等)。
    """
    ts = _run_py2ts(python_code)
    imports, body = _parse_ts_output(ts)
    if not body:
        raise RuntimeError("py2ts 转换后未提取到函数体")
    body = _post_process_body(body)
    # scene 也需要从 ctx 解构(py2ts body 里用 scene,但 scene 是 ctx 已有的 key)
    need = ["scene"] + [i for i in imports if i != "scene"]
    # 去重保序
    seen = set()
    uniq = []
    for n in need:
        if n not in seen:
            seen.add(n)
            uniq.append(n)
    destructure = "const { " + ", ".join(uniq) + " } = ctx;"
    # params 不是 manim 导出,是前端注入的;若 body 用了 params.xxx,必须手动加入解构
    if "params." in body or "params," in body or "params }" in body:
        if "params" not in seen:
            destructure = "const { " + ", ".join(uniq) + ", params } = ctx;"
    # matMul 是前端注入的矩阵乘法辅助函数;若 body 用了 matMul(由 @ 转换来),加入解构
    if "matMul(" in body:
        if "matMul" not in destructure:
            destructure = destructure.replace(" } = ctx;", ", matMul } = ctx;")
    # np: 前端 ctx 注入的 numpy polyfill;若 body 用了 np.xxx,加入解构
    if re.search(r"\bnp\.", body):
        if " np" not in destructure:
            destructure = destructure.replace(" } = ctx;", ", np } = ctx;")
    return destructure + "\n" + body


def convert_step_python(step: dict) -> dict:
    """把 step 里的 pythonCode 转成 sceneCode,原 dict 上加 sceneCode 字段并返回。

    若 pythonCode 为空或转换失败,保留原 sceneCode(若有)并记录错误。
    """
    py = step.get("pythonCode", "")
    if not py.strip():
        return step
    try:
        code = python_to_scene_code(py)
        step["sceneCode"] = code
        from .debug_log import dlog
        dlog(f"py2ts OK pythonCode_len={len(py)} sceneCode_len={len(code)}")
    except Exception as e:
        # 转换失败:把错误信息记到 step,前端可触发 regenerate
        step.setdefault("sceneCode", "")
        step["_convert_error"] = f"{type(e).__name__}: {e}"
        from .debug_log import dlog
        dlog(f"py2ts FAIL pythonCode_len={len(py)} err={type(e).__name__}: {e}")
    return step


if __name__ == "__main__":
    # 自测
    sample = '''
from manim import *

class GradStep(Scene):
    def construct(self):
        axes = Axes(
            x_range=[-4, 4, 1],
            y_range=[0, 8, 1],
            x_length=8,
            y_length=5,
            axis_config={"color": BLUE},
        )
        curve = axes.plot(lambda x: 0.5 * x ** 2, color=BLUE)
        dot = Dot(point=axes.c2p(2.0, 2.0), color=YELLOW)
        self.play(Create(axes))
        self.play(Create(curve))
        self.play(FadeIn(dot))
        self.wait(1)
'''
    out = python_to_scene_code(sample)
    print("===== CONVERTED sceneCode =====")
    print(out)
