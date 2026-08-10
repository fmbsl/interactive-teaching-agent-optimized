"""框架无关的 manim 教学脚本生成 skill。

设计目标:
- 核心是纯函数 generate_lesson(),不依赖任何 agent 框架。
- 提供 as_langchain_tool() 包装成 LangChain/LangGraph 的 @tool。
- 提供 LESSON_SCHEMA (JSON Schema) 供其他框架(OpenAI Agents SDK / Pydantic AI)直接接。
- LLM 调用走 OpenAI 兼容接口(传入 client),不绑死任何 provider。

这样同一份"生成教学脚本"能力,可被任意主流 agent 框架复用。
"""
from __future__ import annotations
import json
import os
from dataclasses import dataclass
from typing import Any, Optional

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore

try:
    from langchain_core.tools import tool as _lc_tool
except Exception:  # pragma: no cover
    _lc_tool = None  # type: ignore




OUTLINE_PROMPT = """你是教学知识点拆解专家。用户提出一个 STEM 知识点(可能附文件内容),你把它拆成一系列递进的子知识点。

只输出 JSON,不要任何其他内容:
{
  "title": "知识点总称",
  "summary": "一句话概括(可空)",
  "steps": [
    {"id": 1, "title": "子知识点标题(简短,如'矩阵乘法的定义')"}
  ]
}

要求:
1. 子知识点数量由知识点本身的复杂度决定:简单概念少拆,复杂体系多拆。不要为凑数而硬拆,也不要漏掉关键环节。
2. 拆解顺序按这个知识点怎么讲最顺来定:从学生已有的认知出发,一步步建立到目标。是否引入动机/示例/陷阱/拓展由你按内容取舍,别套固定模板。
3. 每个子知识点只给一个简短标题(10-20字),不要写动画描述、公式、讲解、参数——那些由下游设计。
4. 子知识点之间要有逻辑连续性,后一个建立在前一个之上。
5. 若提供文件内容,围绕文件中的知识点拆解。
6. 全程中文。"""


# 保留旧名作别名(generate_lesson 仍用,作回退)
SYSTEM_PROMPT = OUTLINE_PROMPT


@dataclass
class LLMConfig:
    base_url: str
    api_key: str
    model: str
    model_fallback: Optional[str] = None
    # 备用模型可用独立 endpoint/key(若主模型在另一平台,fallback 在 DeepSeek 等)
    fallback_base_url: Optional[str] = None
    fallback_api_key: Optional[str] = None
    # 主模型是否支持图像输入(视觉)。true→update_animation 通过后可把最后一帧 base64
    # 随消息给主模型自检;false→走单独配置的视觉辅助模型(_get_vision_cfg)。
    supports_vision: bool = False
    # step_agent 的推理强度:low/medium/high,或 ""/"off" 关闭 thinking。
    # deepseek-v4-flash 上 high 每轮 LLM 调用多 ~15s(思考 token)+ 输出更长 → 一步生成慢;
    # low 显著提速但代码更短/动画更简(浏览器在环验证仍兜底)。按接入点配置,设置面板可调。
    reasoning_effort: str = "high"


def _default_config() -> LLMConfig:
    return LLMConfig(
        base_url=os.getenv("LLM_BASE_URL", "https://api.deepseek.com/"),
        api_key=os.getenv("LLM_API_KEY", ""),
        model=os.getenv("LLM_MODEL", "deepseek-chat"),
        model_fallback=os.getenv("LLM_MODEL_FALLBACK"),
        fallback_base_url=os.getenv("LLM_FALLBACK_BASE_URL"),
        fallback_api_key=os.getenv("LLM_FALLBACK_API_KEY"),
    )


def _get_runtime_cfg() -> "LLMConfig":
    """取运行时启用接入点(优先 llm_endpoints.json,无则回退 .env)。懒加载避免循环导入。"""
    try:
        from .llm_config_store import get_active_config
        return get_active_config()
    except Exception:
        return _default_config()


def _call_llm(prompt: str, cfg: LLMConfig, client: Optional["OpenAI"] = None, system_prompt: str = None) -> dict:
    """调 OpenAI 兼容接口,返回解析后的 dict。主模型失败自动回退(可用独立 endpoint/key)。"""
    if client is None and OpenAI is not None:
        client = OpenAI(base_url=cfg.base_url, api_key=cfg.api_key or "dummy")
    if system_prompt is None:
        system_prompt = SYSTEM_PROMPT

    # (model, client) 序列:主模型用传入 client;fallback 若配了独立 endpoint 用新 client
    attempts: list = [(cfg.model, client)]
    if cfg.model_fallback:
        if cfg.fallback_base_url and cfg.fallback_api_key and OpenAI is not None:
            fb_client = OpenAI(base_url=cfg.fallback_base_url, api_key=cfg.fallback_api_key)
            attempts.append((cfg.model_fallback, fb_client))
        else:
            attempts.append((cfg.model_fallback, client))
    last_err: Optional[Exception] = None
    for m, c in attempts:
        try:
            resp = c.chat.completions.create(
                model=m,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,
            )
            content = resp.choices[0].message.content or ""
            # 落盘完整 LLM 回答,便于事后定位(转换报错时看 LLM 到底写了什么)
            try:
                from .debug_log import dlog, log_path as _dbg_path
                import os as _os, datetime as _dt
                kind = "step" if system_prompt is STEP_PROMPT else ("outline" if system_prompt is OUTLINE_PROMPT else "other")
                _resp_path = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "llm_responses.log")
                with open(_resp_path, "a", encoding="utf-8") as _f:
                    _f.write(f"\n===== {_dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} model={m} kind={kind} len={len(content)} =====\n")
                    _f.write(content)
                    _f.write("\n")
            except Exception:
                pass
            return _parse_json_lenient(content)
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"所有模型均失败:{last_err}")


def _parse_json_lenient(content: str) -> dict:
    """容错 JSON 解析:去掉 markdown 代码块围栏,提取首个 { 到匹配 } 的子串。
    有些平台不支持 response_format=json_object,LLM 可能在 JSON 外加 ```json 围栏或解释文字。"""
    s = content.strip()
    # 去代码块围栏
    if s.startswith("```"):
        lines = s.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    # 若还有非 JSON 前缀,从首个 { 开始
    i = s.find("{")
    if i > 0:
        s = s[i:]
    # 从末尾找最后一个 }
    j = s.rfind("}")
    if j >= 0 and j < len(s) - 1:
        s = s[: j + 1]
    try:
        return json.loads(s)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM 返回非合法 JSON: {e}; content 片段: {content[:200]!r}")


def _validate(lesson: dict) -> dict:
    """轻量校验 + 补全,保证前端拿到的是合法结构。"""
    if not isinstance(lesson, dict) or "steps" not in lesson or not lesson["steps"]:
        raise ValueError("LLM 返回格式不正确:缺少 steps")
    lesson.setdefault("title", "教学脚本")
    lesson.setdefault("summary", "")
    lesson.setdefault("params", [])
    for i, s in enumerate(lesson["steps"], 1):
        s.setdefault("id", i)
        s.setdefault("title", f"第 {i} 步")
        s.setdefault("intent", "")
        s.setdefault("formula", "")
        s.setdefault("narration", "")
        s.setdefault("paramsUsed", [])
    return lesson


def generate_lesson(
    question: str,
    file_text: Optional[str] = None,
    client: Optional["OpenAI"] = None,
    cfg: Optional[LLMConfig] = None,
) -> dict:
    """核心 skill:问题(+可选文件文本)-> Lesson JSON dict。

    框架无关:不 import 任何 agent 框架,只依赖 openai SDK 走兼容接口。
    可被 LangGraph / OpenAI Agents SDK / Pydantic AI / 裸调用 等任意方式复用。
    """
    cfg = cfg or _get_runtime_cfg()
    prompt = question
    if file_text:
        # 截断超长文件,避免 token 爆炸
        ft = file_text[:8000]
        prompt = f"用户上传的文件内容(作为讲解上下文,优先围绕其中的知识点):\n```\n{ft}\n```\n\n用户的问题:{question}"
    raw = _call_llm(prompt, cfg, client)
    return _validate(raw)

def generate_outline(
    question: str,
    file_text: Optional[str] = None,
    client: Optional["OpenAI"] = None,
    cfg: Optional[LLMConfig] = None,
) -> dict:
    """主 agent:问题 -> 只拆知识点 outline({title, steps:[{id,title}]})。不设计动画。"""
    cfg = cfg or _get_runtime_cfg()
    prompt = question
    if file_text:
        ft = file_text[:8000]
        prompt = f"用户上传的文件内容(围绕其中的知识点拆解):\n```\n{ft}\n```\n\n用户的问题:{question}"
    raw = _call_llm(prompt, cfg, client, system_prompt=OUTLINE_PROMPT)
    # 校验 outline
    if not isinstance(raw, dict) or "steps" not in raw or not raw["steps"]:
        raise ValueError("outline 格式不正确")
    raw.setdefault("title", question[:20])
    raw.setdefault("summary", "")
    raw.setdefault("params", [])
    for i, st in enumerate(raw["steps"], 1):
        st.setdefault("id", i)
        st.setdefault("title", f"第 {i} 步")
        # outline 阶段不含 intent/formula/narration/paramsUsed,留空
        st.setdefault("intent", "")
        st.setdefault("formula", "")
        st.setdefault("narration", "")
        st.setdefault("paramsUsed", [])
    return raw


STEP_PROMPT = """你是教学动画设计 agent(下游)。给你一个子知识点,你要设计它在浏览器里如何讲解:动画代码、公式、讲解文字、可调参数。

你能看到**前一个子知识点的讲解和动画代码**,要保持连续性(术语一致、画面延续、可在前者基础上推进)。

只输出 JSON,不要其他内容:
{
  "title": "本子知识点标题(可润色)",
  "intent": "动画意图:这一步画面上展示什么(1-2句)",
  "formula": "KaTeX 公式字符串(LaTeX 语法,中文用 \\text{} 包裹),无公式则空字符串",
  "narration": "面向学生的中文讲解,100-200字,承接上文、引出本步",
  "params": [{"name":"英文小写","label":"中文","min":数字,"max":数字,"step":数字,"default":数字}],
  "sceneCode": "manim-web TypeScript 函数体(见下方规则)"
}

═══════════════════════════════════════════
一、sceneCode 是什么 / 怎么被运行
═══════════════════════════════════════════
sceneCode 是一段 **JavaScript/TypeScript 函数体字符串**(不要写 function 包裹、不要 export、不要反引号代码块),在浏览器里用 `new AsyncFunction("ctx", code)` 执行,所以:
- 顶部第一行必须从 ctx 解构出你要用的标识符:`const { scene, Axes, Dot, Text, Create, params } = ctx;`(只解构用到的)。
- 用 `await scene.play(...)`(支持 await)、`scene.add(...)`、`await scene.wait(n)`。
- 代码里可直接用 JS:变量、箭头函数、for/while、Math.*、数组方法。
- **不要写 import、不要写 class、不要写 `new Scene(...)`**——scene 已由 ctx 注入。
- 可调参数用 `params.<name>` 读取(前端注入,值是数字)。**不要给 params 加默认值兜底**(如 `params.x ?? 1`)——前端按 params 配置的 default 注入,直接 `const x = params.x;` 即可。

═══════════════════════════════════════════
二、API REF(manim-web 0.3.24 真实签名,照此写)
═══════════════════════════════════════════
所有构造都是 `new Class({...options})` 选项对象风格,camelCase key。坐标 2D `[x,y,0]`,3D `[x,y,z]`。颜色用 CSS 字符串(如 `'#4a9eff'`)或 manim 常量(已注入:`BLUE`/`BLUE_B`/`BLUE_C`/`BLUE_D`/`BLUE_E`/`WHITE`/`GRAY`/`LIGHT_GRAY` 等)。**配色可丰富**(多色区分元素,见第五节教学与视觉规范)。

【场景控制】
- `scene.add(...mobs)` / `scene.remove(...mobs)` / `await scene.wait(duration?)`
- `await scene.play(...animations)` —— play 不接受选项,**每个动画的时长在该动画的 options 里设**:`await scene.play(new Create(mob, { duration: 1.5 }))`。
- 3D(用 ThreeDScene 时):
  - `scene.setCameraOrientation(phi, theta, distance?)` —— 位置参数,phi 极角(0=顶,PI=底)、theta 方位角。用 `scene.setCameraOrientation(70*(Math.PI/180), -45*(Math.PI/180))`。
  - `scene.moveCamera({ phi, theta, distance, duration })` —— 动画移动相机。
  - `scene.beginAmbientCameraRotation(rate?)` / `scene.stopAmbientCameraRotation()` —— 自动旋转。
  - `scene.addFixedInFrameMobjects(...mobs)` —— 把 2D 文字钉到屏幕帧(不受 3D 相机影响,标题/标注用)。**只能钉 2D VMobject(Text/MathTex),不能钉 3D 对象(Dot3D/Sphere 等不要钉)**。钉了即等于加入场景,不要再 `scene.add` 同一个。
  - `scene.addFixedOrientationMobjects(...mobs)` —— 3D 场景里保持朝向(文字面对相机)。

【2D 图形】
- `new Axes({ xRange:[min,max,step], yRange:[min,max,step], xLength, yLength, color, tips, tipLength })`
  - `axes.plot(fn, { xRange:[min,max], color, strokeWidth })` → 函数曲线,fn 是 `(x)=>number`。
  - `axes.c2p(x, y)` / `axes.coordsToPoint(x, y)` → `[x,y,0]` 视觉坐标。
  - `axes.getAxisLabels(xLabel?, yLabel?)` → Group(xLabel/yLabel 是字符串或 Mobject,默认 "x"/"y")。
  - `axes.getArea(graph, [x0, x1], { boundedGraph?, color, opacity })` → 填充面积。
  - `axes.getRiemannRectangles(graph, { xRange, dx, color, fillOpacity })` → 黎曼矩形 VGroup。
  - `axes.getVerticalLine(point, { color, strokeWidth })` → 竖线。
  - `axes.i2gp(x, graph)` / `axes.inputToGraphPoint(x, graph)` → x 对应曲线上的点。
- `new NumberPlane({ xRange, yRange })` —— 带网格坐标平面(Axes 子类)。
- `new Dot({ point, radius, color, fillOpacity, strokeWidth })`
- `new Line({ start, end, color, strokeWidth })`
- `new Arrow({ start, end, color, strokeWidth, tipLength, tipWidth })`
- `new Circle({ radius, color, fillOpacity, strokeWidth })`
- `new Rectangle({ width, height, color })` / `new Square({ sideLength, color })`
- `new Text({ text, fontSize, fontFamily, color, fillOpacity })` —— 普通文字/标注(非数学公式)。**必须带 `fontFamily: '"Times New Roman","SimSun",serif'`**(衬线宋体;中文走 SimSun,英文/数字走 Times New Roman)。字号用数字(默认 48)。
- `new MathTexImage({ latex, color, fontSize, renderer })` —— **公式首选**(用 KaTeX 渲染成位图,`renderer` 默认 `'auto'`:先 KaTeX 后 MathJax 兜底)。需要 `await x.waitForRender()`。KaTeX 不依赖异步字体加载,稳定;`\overrightarrow`/`\mathcal`/花体等动态字体命令也能正常渲染。
- `new MathTex({ latex, color, fontSize, fillOpacity, displayMode })` / `new Tex({ latex, color, fontSize })` —— 矢量 LaTeX(MathJax)。**慎用**:MathJax 在浏览器里异步加载字体,`\overrightarrow`/`\mathcal`/`\mathscr`/花体等需动态字体的命令会触发 `MathJax retry` 报错(渲染失败,且错误被静默吞掉,主舞台读几何时才抛)。**含这类命令的公式一律改用 MathTexImage**。简单公式(`\frac`/上下标/`\sum`/`\int`/希腊字母)MathTex 可用,但若验证报 "公式渲染失败/MathJax" 就改 MathTexImage。`latex` 是 LaTeX 字符串(如 `"\\frac{d}{dx}\\sin(x)=\\cos(x)"`),用前 `await eq.waitForRender()`。`fontSize` 用像素大数(48-120)。多段公式用 `latex: ["a","+","b"]` 数组。
- `new VGroup(...mobs)` —— 分组,可一起 play/add。`vg.get(i)` 取第 i 个子元素(**不要用 `vg[i]` 下标**)。

【3D 图形(需 ThreeDScene)】
- `new ThreeDAxes({ xRange:[min,max,step], yRange, zRange, axisColor, xColor, yColor, zColor, showLabels, labelFontSize })`
  - `axes.c2p(x, y, z)` / `axes.coordsToPoint(x, y, z)` → `[x,y,z]`。
  - `axes.getAxisLabels(xLabel?, yLabel?, zLabel?)` → Group。
- `new Surface3D({ func:(u,v)=>[x,y,z], uRange:[min,max], vRange:[min,max], uResolution, vResolution, color, opacity, wireframe, doubleSided, checkerboardColors })` —— 参数曲面。**透明度用 `opacity`**(不是 fillOpacity)。
- `new Sphere({ radius, center, color, opacity, resolution, wireframe })`
- `new Dot3D({ point, radius, color, opacity, glow, glowIntensity })` —— 3D 点标记,glow=true 高亮。
- `new Arrow3D({ start, end, color, opacity, tipLength, tipRadius, shaftRadius })` —— **start/end 必须是纯 `[x,y,z]` 数组**(不要数组+数组,见铁律 1)。
- `new Line3D({ start, end, color, lineWidth, opacity })` —— 3D 线段,lineWidth 是 CSS 像素。
- `new Cube({ sideLength, center, color, opacity, wireframe })`
- `new Cylinder(...)` / `new Torus(...)` / `new Prism({ sides, radius, height, ... })` —— 类似。

【动画(都 `new Animation(mob, { duration, rateFunc, ... })`,所有动画都接受 `duration` 和 `rateFunc`)】
动画是观感的关键——不要只会 `Create`+`FadeIn`。按用途选合适的动画,画面才生动。所有动画构造都是 `new X(mob, { duration, rateFunc, ... })`,可加 `rateFunc`(见下节)控制缓动。

进场:
- `new Create(mob, { duration })` —— 描线出现(曲线、坐标轴、几何形的轮廓)。默认进场首选。
- `new Write(mob, { duration })` —— 书写式出现,**文字/公式/MathTex 进场首选**(比 FadeIn 有"写出来"的感觉)。
- `new DrawBorderThenFill(mob, { duration })` —— 先描边再填色,适合带填充的几何形(Circle/Rectangle/多边形)。
- `new FadeIn(mob, { duration, shift })` —— 淡入(可带 `shift:[dx,dy,dz]` 方向)。辅助标注、成组元素用。
- `new GrowFromCenter(mob, { duration })` —— 从中心放大出现。`new GrowArrow(arrow)` —— 箭头从尾部长出(向量进场首选,只接 Arrow)。`new GrowFromEdge(mob, { edge: UP, duration })` —— 从指定边缘长出(`edge` 在 options 里,用方向常量 `UP`/`DOWN`/`LEFT`/`RIGHT`)。`new GrowFromPoint(mob, { point: [x,y,0], duration })` —— 从指定点长出。`new SpinInFromNothing(mob, { duration })` —— 旋转出现。

退场:
- `new FadeOut(mob, { duration, shift })` —— 淡出。`new Uncreate(mob, { duration })` —— 反向擦除(配合 Create 用)。`new Unwrite(mob, { duration })` —— 反向擦写(配合 Write 用)。

形变/替换:
- `new Transform(mobA, mobB, { duration })` —— **只在同类间用**(两个 Dot、两个 Text;不要 Dot↔Text 或 Circle↔Polygon,点数不匹配会报错)。
- `new ReplacementTransform(mobA, mobB, { duration })` —— 同类形变,比 `Transform` 更稳健(原地替换,推荐用它代替 Transform)。
- `new TransformFromCopy(src, dst, { duration })` —— 从 src 复制一份变形成 dst,**src 保留不动**(演示"由 A 得到 B"时用,如从原向量复制出变换后的向量)。
- `new FadeTransform(mobA, mobB, { duration })` —— 跨类淡变(文字↔文字、不同点数对象),点数不匹配也不会报错。
- `new TransformMatchingTex(texA, texB, { duration })` —— **公式逐项对应变换**(如 `a+b` → `a+b=c`),教学公式推导神器,LaTeX 相同部分保持、新增部分淡入。

强调:
- `new Indicate(mob, { duration })` —— 短暂放大+变色再回弹,"看这里"。
- `new Flash(mob, { duration, color })` —— 闪光放射。
- `new Circumscribe(mob, { duration, color })` —— 画框框住(框出关键量/结果)。
- `new FocusOn(mob, { duration, color? })` —— 相机/焦点聚焦到该 mobject(注意第一参是 **mobject**,不是 point)。
- `new Wiggle(mob, { duration })` —— 摇晃。`new ShowPassingFlash(mob, { duration })` —— 扫过一道光。
- `new Pulse(mob, { duration })` —— 脉冲。

其它:
- `new ApplyFunction(mob, { func: (p)=>[x,y,z], duration })` —— 对每个点施加函数,做网格扭曲。**func 必须逐分量返回数组**:`(p) => [p[0], p[1] + 0.3*Math.sin(p[0]), p[2]]`,不要 `p + [...]`(见铁律 1)。注意 `func` 在 options 对象里(`{ func, duration }`),不是独立位置参数。
- `new Rotating(mob, { ... })` —— 持续旋转。
- `new MoveAlongPath(mob, { path, duration, rotateAlongPath? })` —— 沿路径移动(点沿曲线运动)。`path` 是路径 VMobject(在 options 对象里,不是独立位置参数)。

【.animate 链(链式动画)】
- `mob.animate.moveTo(target, alignedEdge?)` / `.shift([dx,dy,dz])` / `.rotate(angle, axis?)` / `.scale(factor)` / `.setColor(c)` / `.setFillOpacity(o)` / `.setStrokeWidth(w)` / `.nextTo(target, dir, buff?)` / `.toEdge(dir)` / `.center()`
- 例:`await scene.play(mob.animate.moveTo([1,0,0]).rotate(Math.PI));`
- **时长控制**:`await scene.play(mob.animate.moveTo(p), { duration: 1 })` 这种写法 **duration 注入不到 .animate**。要控制 .animate 时长,用 `mob.animate.moveTo(p).withDuration(1)`(AnimateProxy 的方法,注意是 **小写 `withDuration`**,不是 `WithDuration`),或改用 `new ApplyFunction` / `tracker.animateTo`。简单场景可直接接受默认 1 秒。
- ⚠️ **改透明度的正确方法**(实测,别用错):
  - **动画过渡**:`mob.animate.setFillOpacity(0.3)`(✓ 可用)。
  - **即时改(非动画)**:`mob.setFillOpacity(0.3)` / `mob.setStrokeOpacity(0.3)`(两者普通 mobject 都有)/ `mob.opacity = 0.3`。
  - **统一用 `setFillOpacity` 最省心**:它在 `.animate` 链和普通 mobject 上都有。`setStrokeOpacity` 只在普通 mobject(不能 `.animate.`)。`setOpacity` **两处都没有**(普通 mobject 无此方法;AnimateProxy 有定义但转发到 mobject 时报 not found),完全不要用。

【编排与节奏(让动画有层次,不要全串行也不要全瞬切)】
⚠️ **AnimationGroup / LaggedStart / Succession 都接 `(animations数组, options)`,不是展开参数**——第一个参数必须是**已构造好的 Animation 数组**,options 是第二个参数。写错(用 `...spread` 把 options 混进参数)会报 `e107.map is not a function`。
- **成组播放**:`await scene.play(new AnimationGroup([animA, animB, animC], { lagRatio: 0.3 }))` —— 多个动画错峰播放。`lagRatio`:0=齐发(同时),1=纯串行(一个完才下一个),**0.2-0.4 最自然**。例:多个点依次淡入用 `new AnimationGroup(dots.map(d => new FadeIn(d)), { lagRatio: 0.2 })`(注意:传**数组** `dots.map(...)`,不要 `...dots.map(...)` 展开)。
- **依次进场(同类对象同一动画)**:`new LaggedStartMap(AnimClass, [mob1, mob2, mob3], { lagRatio: 0.2 })` —— 对一组同类 mobject 依次施加同一动画类(向量场箭头、点群、矩形序列用)。第一个参数是**动画类**(如 `FadeIn`),第二个是 **mobject 数组**。例:`new LaggedStartMap(Create, rects, { lagRatio: 0.1 })`。(若每对象动画参数不同,改用 `new LaggedStart([new FadeIn(a), new FadeIn(b)], { lagRatio: 0.2 })`,传构造好的动画数组。)
- **严格分阶段**:`new Succession([animA, animB, animC])` —— 一个播完才下一个(无重叠),用于"先 A 再 B 再 C"的因果演示。
- **缓动 rateFunc**(所有动画的 options 都接受 `rateFunc`,从 ctx 解构):公式/文字进场用 `easeOut`(轻快收尾)、形变用 `smooth`(默认,自然)、弹性效果用 `easeOutBounce`、强调往返用 `thereAndBack`、 lingering(结尾停留)。例:`new Write(eq, { duration: 1, rateFunc: easeOut })`。**别让所有动画都用默认线性**——机械感重。常用:`smooth`/`easeOut`/`easeInOut`/`thereAndBack`/`lingering`/`easeOutBounce`。


- `new ValueTracker(initialValue)` —— `tracker.getValue()` / `tracker.setValue(v)` / `tracker.animateTo(target, { duration })`(返回 Animation,可 play)。
- `mob.addUpdater((m, dt) => { ... })` —— 每帧调用,dt 是帧间隔秒。**updater 回调里不要写 await**。`mob.removeUpdater(fn)` 或 `mob.clearUpdaters()` 清除。
- 典型:tracker 驱动一个随参数动的对象:
  ```
  const t = new ValueTracker(0);
  dot.addUpdater((m) => m.moveTo(axes.c2p(t.getValue(), Math.sin(t.getValue()))));
  scene.add(dot);
  await scene.play(t.animateTo(6, { duration: 3 }));
  ```

【ctx 还注入的辅助】
- `matMul(A, B)` —— 矩阵乘(JS 没有 `@`,矩阵乘法用它,A/B 是二维数组)。
- `np` —— numpy 标量函数 polyfill:`np.sin/cos/sqrt/exp/log/pi/e/array/arange/linspace/zeros/ones/linalg.norm/linalg.dot`。**不支持逐元素向量化**(对数组做算术得 NaN,见铁律 1),需逐元素用 `arr.map(f)` 或 `np.vectorize(f)(arr)`。
- `alwaysRedraw(fn)` —— 简化 stub(取首帧静态,非每帧重算)。需要每帧重算请用 `addUpdater`。

═══════════════════════════════════════════
三、运行时铁律(会静默失败或报错的坑,务必遵守)
═══════════════════════════════════════════
1. **禁用「数组 + 数组」算术(致命,静默失败)**:JS 里 `[1,2,3] + [4,5,6]` 得字符串 `"1,2,34,5,6"`,不是逐元素加。`p + UP`、`mob.getCenter() + [0.6,0,0]`、`[x,y,z] + dir` 都会变成字符串;喂给 Arrow3D/Line3D 的 start/end 会**静默擦除 3D 网格且不报错**。合规写法:(a)整个数组原样传 `mob.getCenter()`;(b)逐分量 `const c = mob.getCenter(); const s = [c[0]+0.6, c[1], c[2]];`;(c)平移用 `mob.shift([dx,dy,dz])`。
2. **3D 实体透明用 `opacity`,不是 `fillOpacity`**:Surface3D/Sphere/Dot3D/Arrow3D/Line3D/Cube 只认 `opacity`。
3. **VGroup / 数组取子元素用 `.get(i)`,不要 `[i]`**:`vg[0]` 返回 undefined。用 `vg.get(i)` 或 `vg.submobjects[i]`。Matrix 取元素用 `M.getEntry(i,j)`。
4. **Transform 只在同类间用**:点数结构要匹配,跨类(如 Dot↔Text)会报 `alignVmobjectPair ... does not match point count`。跨类用先 `scene.remove(old)` 再 `new FadeIn(new)`。
5. **`addFixedInFrameMobjects` 只钉 2D**:Text/MathTex 可钉;Dot3D/Sphere/Arrow3D 等 3D 对象不要钉,直接 `scene.add`。钉了即加入场景,勿重复 add。
6. **不要用未实现的**:`Intersection`/`Union`/`Exclusion`/`Difference`(布尔运算)、`set_fill_by_checkerboard`(用 `checkerboardColors` 选项替代)、`alwaysRedraw` 的每帧重算(用 `addUpdater`)。
7. **解构行必须包含代码里用到的所有标识符**(不仅是 `params`):代码里出现 `params.lr`、`AnimationGroup`、`Write`、`BLUE_C`、`easeOut` 等任何从 ctx 取的名字,开头的 `const { scene, ..., params } = ctx;` 就必须列出它。**方向常量 `LEFT/RIGHT/UP/DOWN/UL/UR/DL/DR/ORIGIN/IN/OUT` 用到 `shift/nextTo/moveTo` 方向时必解构(高频漏,报 `LEFT is not defined`);颜色 `BLUE/RED/YELLOW/WHITE/...`、类名 `Dot/Line/Axes/...` 同理。** 漏了会 `ReferenceError: XXX is not defined`。**局部改(update_animation old_str/new_str)时若新代码引入了新标识符,务必同步加进解构行**(高频坑:加了 `new AnimationGroup(...)` 却没把 `AnimationGroup` 加进解构)。若该步无参数,就完全不要引用 `params`。
8. **`new VGroup(...)` 不要在空/未填充时取中心或边界**:`vg.getCenter()`/`getBoundingBox()` 在 group 无子元素时抛 `cannot compute center of an empty group`。要么构造时直接传入子元素 `new VGroup(a, b, c)`,要么先 `vg.add(x)` 再取中心;不要 `new VGroup()` 后立刻 `getCenter()`。
9. **ValueTracker + addUpdater 必防首帧 NaN(高频,会让标签显示 "NaN°"、对象坐标变 NaN 被打回)**:
   - `new ValueTracker(初值)` **必须给初值**;创建后立刻 `scene.add(tracker)`(未 add 的 tracker 在 updater 首帧 `getValue()` 返回 undefined -> 级联 NaN)。
   - `mob.addUpdater(() => f(tracker.getValue()))` 里,`getValue()` 首帧可能未就绪 -> **必须兜底**:`const v = tracker.getValue() ?? 初值;`,用 v 参与运算,不要把 getValue() 直接喂给 Math.sin/cos/atan2/round/坐标。
   - **不要传 `params.xxx` 给函数却没在 set_step 的 params 里声明该字段**:`params.angle` 未声明 = undefined,进 `deg * Math.PI/180` = NaN。用到的 params 字段必须在 set_step 里声明;代码里读前可 `const a = params.angle ?? 0;` 兜底。
   - 任何进 Math.sin/cos/atan2/坐标的值,先确保是有限数(`Number.isFinite(x)` 不成立就回退初值),别让 NaN 流进 Text/坐标。
10. **改透明度统一用 `setFillOpacity`,`setOpacity` 完全不要用**:实测 `setOpacity` **两处都报错**——普通 mobject 无此方法(`is not a function`)、`.animate.setOpacity` 转发时报 `AnimateProxy: method "setOpacity" not found`。改透明度:动画过渡用 `mob.animate.setFillOpacity(o)`,即时改用 `mob.setFillOpacity(o)` / `mob.setStrokeOpacity(o)` / `mob.opacity = o`。注意 `setStrokeOpacity` 只在普通 mobject 上(不能 `.animate.setStrokeOpacity`)。`withDuration` 是小写 `w`(不是 `WithDuration`)。
11. **构图用相对定位,不要手算 `shift`/`moveTo` 世界坐标**:文字/标签/矩阵用 `mob.nextTo(ref, dir, buff)` 相对参照物定位(`dir` 用 `UP/DOWN/LEFT/RIGHT/UL..`,`buff` 用 `SMALL_BUFF`/`MED_SMALL_BUFF` 或 0.1-0.3);整组用 `new Group(a, b, c)` 或 `new VGroup(...)` 包起来再整体 `moveTo`/`toEdge`。**禁止靠 `toEdge(UP).shift([4.4, -0.55, 0])` 或 `moveTo([-5.4, 1.8, 0])` 这种硬算偏移凑位置**——画面会拥挤错位、易重叠(触发 BB 检测打回;报错会带文字坐标 `@(≈x,y)`,据此往反方向移)。
12. **坐标轴(Axes)场景的轴标签/标注必须用轴的坐标系,不要用全局世界坐标**:`Axes` 旁边手动摆文字时,永远是 `label.nextTo(ax.c2p(x, y), dir, buff)`(`c2p` 把数据坐标转成轴内 world 坐标)或用 `ax.getAxisLabels(xLabel, yLabel)` 自动放;曲线上的点/标签也一样 `nextTo(ax.c2p(...))`。**禁止用 `moveTo`/`shift` 直接给一个全局数值坐标**——轴经过 `ax.shift(...)` 后全局原点变了,你手算的坐标几乎必然压在曲线/刻度/网格上,导致「文字与图形对象重叠」反复打回且越改越乱。以曲线 `curve` 上的 peak/trough 标注为例:`dot.nextTo(peakPoint, UP, 0.15)`、`label.nextTo(peakPoint, RIGHT, 0.2)`,`peakPoint` 来自 `ax.c2p(peakX, curveFn(peakX))`,不是手写数组。
13. **画面布局清晰不拥挤**:别把所有文字/公式堆在一起压到图形上——用相对定位分散摆放、留出间距,让每处标注都独立可读。公式块别和图形/标签挤同一位置;临时说明文字切换阶段时先淡出旧的再进新的,不要同位叠放。具体怎么排(上下/左右/分区)由你按画面定。
14. **动画前对象必须先在场景里**:`ApplyFunction`/`Transform`/`.animate` 等动画只对**已在场景中的 mobject** 有效。`const x = obj.copy()` 复制出的副本若没 `scene.add(x)`(或经 `FadeIn`/`Create`/`GrowArrow` 进场),对其做动画**屏幕上看不到**——点会变但画面不变。**每次 `copy()` 出副本要立刻想着"它怎么进场景"**(`scene.add` 或进场动画),否则白做。典型坑:用副本演示"原图 → 变换后",原图和副本都要进场景,只进原图、对副本 ApplyFunction 就只看到原图不动。
15. **`waitForRender()` 只用于公式对象**:只有 `MathTexImage`/`MathTex`/`Tex`/`Variable` 有此方法(异步 LaTeX 渲染需等待)。**`Text`/`Dot`/`Arrow`/`Line`/`Circle`/`VGroup` 等普通 mobject 没有 `waitForRender`**,对它们调会报 `Cannot read properties of undefined (reading 'waitForRender')`。公式才 `await eq.waitForRender()` 后再 `scene.add`/`play`;Text 等直接 `scene.add`,不要 waitForRender。

═══════════════════════════════════════════
四、FEW SHOT(实测可运行的写法,照此模板)
以下 10 个示例改写自 manim-web 官方 examples(maloyan 维护,实测可运行),覆盖 2D 函数图/向量/积分/ValueTracker/线性变换/公式/3D 曲面/3D 相机。**注意:官方示例用了 RED/GREEN/YELLOW 等多色、且 Text 没带 fontFamily(为展示 API),但你自己的代码必须:(1)配色可丰富但一致、对比清晰(见第五节);(2)所有 Text 带 `fontFamily: '"Times New Roman","SimSun",serif'`;(3)数学公式用 MathTex/Tex 而非 Text**。变量名照官方可保留 snake_case 作参考,但你输出时用 camelCase。其中 `displaying_equations`/`moving_angle` 示例演示了 MathTex/MathTexImage 的用法(`await waitForRender()` 后再 add/play)。

【vector_arrow · 2D 基础:NumberPlane + Dot + Arrow + Text 标注】
```typescript
const { scene, Arrow, DOWN, Dot, NumberPlane, ORIGIN, RIGHT, Text, YELLOW } = ctx;
const dot = new Dot({ point: ORIGIN, radius: 0.12, color: YELLOW });
  const arrow = new Arrow({ start: ORIGIN, end: [2, 2, 0] });
  const numberplane = new NumberPlane();
  const originText = new Text({ text: '(0, 0)' }).nextTo(dot, DOWN);
  const tipText = new Text({ text: '(2, 2)' }).nextTo(arrow.getEnd(), RIGHT);
  scene.add(numberplane, dot, arrow, originText, tipText);
```

【sin_cos_plot · 2D 函数图:axes.plot + getAxisLabels + getVerticalLine + 多曲线】
```typescript
const { scene, Axes, BLUE, GREEN, Line, RED, UP, UR, VGroup, WHITE, YELLOW, scaleVec } = ctx;
const axes = new Axes({
    xRange: [-10, 10.3, 1],
    yRange: [-1.5, 1.5, 1],
    xLength: 10,
    axisConfig: { color: GREEN },
    xAxisConfig: {
      numbersToInclude: [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10],
      numbersWithElongatedTicks: [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10],
    },
    tips: false,
  });
  const axesLabels = axes.getAxisLabels();
  const sinGraph = axes.plot((x) => Math.sin(x), { color: BLUE });
  const cosGraph = axes.plot((x) => Math.cos(x), { color: RED });
  const sinLabel = axes.getGraphLabel(sinGraph, '\\sin(x)', {
    xVal: -10,
    direction: scaleVec(0.5, UP),
  });
  const cosLabel = axes.getGraphLabel(cosGraph, { label: '\\cos(x)' });
  const vertLine = axes.getVerticalLine(axes.i2gp(2 * Math.PI, cosGraph), {
    color: YELLOW,
    lineFunc: Line,
  });
  const lineLabel = axes.getGraphLabel(cosGraph, 'x=2\\pi', {
    xVal: 2 * Math.PI,
    direction: UR,
    color: WHITE,
  });
  const plot = new VGroup(axes, sinGraph, cosGraph, vertLine);
  const labels = new VGroup(axesLabels, sinLabel, cosLabel, lineLabel);
  scene.add(plot, labels);
```

【graph_area_plot · 2D 积分面积:getArea + getRiemannRectangles(微积分教学)】
```typescript
const { scene, Axes, BLUE, BLUE_C, GRAY, GREEN_B, YELLOW } = ctx;
const ax = new Axes({
    xRange: [0, 5],
    yRange: [0, 6],
    xAxisConfig: { numbersToInclude: [2, 3] },
    tips: false,
  });
  const labels = ax.getAxisLabels();
  const curve1 = ax.plot((x) => 4 * x - Math.pow(x, 2), { xRange: [0, 4], color: BLUE_C });
  const curve2 = ax.plot((x) => 0.8 * Math.pow(x, 2) - 3 * x + 4, {
    xRange: [0, 4],
    color: GREEN_B,
  });
  const line1 = ax.getVerticalLine(ax.inputToGraphPoint(2, curve1), { color: YELLOW });
  const line2 = ax.getVerticalLine(ax.i2gp(3, curve1), { color: YELLOW });
  const riemannArea = ax.getRiemannRectangles(curve1, {
    xRange: [0.3, 0.6],
    dx: 0.03,
    color: BLUE,
    fillOpacity: 0.5,
  });
  const area = ax.getArea(curve2, [2, 3], { boundedGraph: curve1, color: GRAY, opacity: 0.5 });
  scene.add(ax, labels, curve1, curve2, line1, line2, riemannArea, area);
```

【moving_dots · ValueTracker + addUpdater + become(动态联动,实时调参)】
```typescript
const { scene, Dot, VGroup, Line, ValueTracker, BLUE, GREEN, RED, RIGHT } = ctx;
const d1 = new Dot({ color: BLUE });
    const d2 = new Dot({ color: GREEN });
    new VGroup(d1, d2).arrange(RIGHT, 1);
    const l1 = new Line({ start: d1.getCenter(), end: d2.getCenter() }).setColor(RED);
    const x = new ValueTracker(0);
    const y = new ValueTracker(0);
    d1.addUpdater((z) => z.setX(x.getValue()));
    d2.addUpdater((z) => z.setY(y.getValue()));
    l1.addUpdater((z) => z.become(new Line({ start: d1.getCenter(), end: d2.getCenter() })));
    scene.add(d1, d2, l1);
    await scene.play(x.animateTo(5));
    await scene.play(y.animateTo(4));
    await scene.wait();
```

【moving_angle · ValueTracker + Angle + addUpdater + animateTo(角度动态追踪)】
```typescript
const { scene, Angle, FadeToColor, LEFT, Line, MathTexImage, RED, RIGHT, SMALL_BUFF, ValueTracker, WHITE } = ctx;
const rotation_center = LEFT;
  const theta_tracker = new ValueTracker(110);
  const line1 = new Line({ start: LEFT, end: RIGHT });
  const line_moving = new Line({ start: LEFT, end: RIGHT });
  const line_ref = line_moving.copy();
  line_moving.rotate(theta_tracker.getValue() * (Math.PI / 180), { aboutPoint: rotation_center });
  const a = new Angle({ line1: line1, line2: line_moving }, { radius: 0.5, otherAngle: false });
  const tex = new MathTexImage({ latex: '\\theta', color: WHITE });
  await tex.waitForRender();
  tex.moveTo(
    new Angle(
      { line1: line1, line2: line_moving },
      { radius: 0.5 + 3 * SMALL_BUFF, otherAngle: false },
    ).pointFromProportion(0.5),
  );
  scene.add(line1, line_moving, a, tex);
  await scene.wait(1);
  line_moving.addUpdater((x) => {
    x.become(line_ref.copy());
    x.rotate(theta_tracker.getValue() * (Math.PI / 180), { aboutPoint: rotation_center });
  });
  a.addUpdater((x) =>
    x.become(new Angle({ line1: line1, line2: line_moving }, { radius: 0.5, otherAngle: false })),
  );
  tex.addUpdater((x) =>
    x.moveTo(
      new Angle(
        { line1: line1, line2: line_moving },
        { radius: 0.5 + 3 * SMALL_BUFF, otherAngle: false },
      ).pointFromProportion(0.5),
    ),
  );
  await scene.play(theta_tracker.animateTo(40));
  await scene.play(theta_tracker.animateTo(theta_tracker.getValue() + 140));
  await scene.play(new FadeToColor(tex, { color: RED, duration: 0.5 }));
  await scene.play(theta_tracker.animateTo(350));
  await scene.wait(1);
```

【apply_matrix_arrows · 线性变换:applyMatrix 对平面和向量同时做矩阵变换】
```typescript
const { scene, Arrow, NumberPlane, Text, YELLOW, GREEN_C, RED_C, applyMatrix } = ctx;
const plane = new NumberPlane();
  scene.add(plane);
  const arrow1 = new Arrow({ start: [-2, -1, 0], end: [2, 1, 0], color: YELLOW });
  const arrow2 = new Arrow({ start: [0, -2, 0], end: [0, 2, 0], color: GREEN_C });
  const arrow3 = new Arrow({ start: [-1, 1, 0], end: [1, -1, 0], color: RED_C });
  scene.add(arrow1, arrow2, arrow3);
  const label = new Text({ text: 'Before shear', fontSize: 48, color: '#ffffff' });
  label.moveTo([0, 3.2, 0]);
  scene.add(label);
  await scene.wait(1);
  // Shear matrix: x' = x + 0.5*y, y' = y
  const shearMatrix = [
    [1, 0.5, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  // Apply the shear to the plane and arrows simultaneously
  await scene.play(
    applyMatrix(plane, shearMatrix, { duration: 2 }),
    applyMatrix(arrow1, shearMatrix, { duration: 2 }),
    applyMatrix(arrow2, shearMatrix, { duration: 2 }),
    applyMatrix(arrow3, shearMatrix, { duration: 2 }),
  );
  // Update label
  scene.remove(label);
  const label2 = new Text({
    text: 'After shear — tips reconstructed',
    fontSize: 48,
    color: '#ffffff',
  });
  label2.moveTo([0, 3.2, 0]);
  scene.add(label2);
  await scene.wait(2);
```

【displaying_equations · Text + MathTexImage + ReplacementTransform(公式推导变换)】
```typescript
const { scene, Text, MathTexImage, Write, ReplacementTransform, FadeOut, WHITE, DOWN } = ctx;
const firstLine = new Text({
    text: 'Manim also allows you',
    fontSize: 36,
    color: WHITE,
  });
  const secondLine = new Text({
    text: 'to show beautiful math equations',
    fontSize: 36,
    color: WHITE,
  });
  const equation = new MathTexImage({
    latex: 'd(p, q) = \\sqrt{\\sum_{i=1}^n (q_i - p_i)^2}',
    fontSize: 48,
    color: WHITE,
  });
  secondLine.nextTo(firstLine, DOWN);
  await equation.waitForRender();
  await scene.play(new Write(firstLine), new Write(secondLine));
  await scene.wait(1);
  await scene.play(new ReplacementTransform(firstLine, equation), new FadeOut(secondLine));
  await scene.wait(3);
```

【three_d_surface_plot · 3D 曲面:Surface3D 高斯面 + checkerboardColors + scale aboutPoint】
```typescript
const { scene, ThreeDAxes, Surface3D, ORANGE, BLUE } = ctx;
const sigma = 0.4;
  const mu = [0.0, 0.0];
  // Gaussian surface: Z-up Manim convention — height is along z.
  const gaussSurface = new Surface3D({
    func: (u, v) => {
      const x = u;
      const y = v;
      const dx = x - mu[0];
      const dy = y - mu[1];
      const d = Math.sqrt(dx * dx + dy * dy);
      const z = Math.exp(-(d * d) / (2.0 * sigma * sigma));
      return [x, y, z];
    },
    uRange: [-2, 2],
    vRange: [-2, 2],
    uResolution: 24,
    vResolution: 24,
    checkerboardColors: [ORANGE, BLUE],
    opacity: 0.85,
  });
  // Scale by 2 about origin (matches Python: gauss_plane.scale(2, about_point=ORIGIN)).
  // Without an explicit aboutPoint, scale() pivots about the surface's geometric
  // center (z≈0.5), which would push the flat base below the z=0 plane.
  gaussSurface.scale(2, { aboutPoint: [0, 0, 0] });
  const axes = new ThreeDAxes({
    xRange: [-6, 6, 1],
    yRange: [-5, 5, 1],
    zRange: [-4, 4, 1],
    axisColor: '#ffffff',
    tipLength: 0.3,
    tipRadius: 0.12,
    shaftRadius: 0.008,
  });
  scene.add(axes);
  scene.add(gaussSurface);
  await scene.wait(999999);
```

【three_d_camera_rotation · 3D 相机:beginAmbientCameraRotation + moveCamera】
```typescript
const { scene, Circle, ThreeDAxes } = ctx;
const axes = new ThreeDAxes({
    xRange: [-6, 6, 1],
    yRange: [-5, 5, 1],
    zRange: [-4, 4, 1],
    axisColor: '#ffffff',
    tipLength: 0.3,
    tipRadius: 0.12,
    shaftRadius: 0.008,
  });
  const circle = new Circle({ radius: 1, color: '#FC6255' });
  scene.add(circle, axes);
  // Begin ambient camera rotation (theta rotates at 0.1 rad/s)
  scene.beginAmbientCameraRotation(0.1);
  await scene.wait(3);
  // Stop rotation and animate camera back to original orientation
  scene.stopAmbientCameraRotation();
  await scene.moveCamera({
    phi: 75 * (Math.PI / 180),
    theta: 30 * (Math.PI / 180),
    duration: 1,
  });
  await scene.wait(1);
```

【three_d_angle · 3D 角度:ThreeDScene 里的 Angle + Line3D】
```typescript
const { scene, Angle, Line3D, ThreeDAxes, WHITE, YELLOW, GREEN } = ctx;
const axes = new ThreeDAxes({
    xRange: [-4, 4, 1],
    yRange: [-4, 4, 1],
    zRange: [-3, 3, 1],
    axisColor: '#ffffff',
    tipLength: 0.3,
    tipRadius: 0.12,
    shaftRadius: 0.008,
  });
  const origin: [number, number, number] = [0, 0, 0];
  const p1: [number, number, number] = [2, 0, 0];
  const p2: [number, number, number] = [0, 1.5, 2];
  const line1 = new Line3D({ start: origin, end: p1, color: YELLOW });
  const line2 = new Line3D({ start: origin, end: p2, color: GREEN });
  const angle = new Angle({ points: [p1, origin, p2] }, { radius: 0.8, color: WHITE });
  scene.add(axes, line1, line2, angle);
  await scene.wait(Infinity);
```

═══════════════════════════════════════════
五、教学与视觉规范
═══════════════════════════════════════════
- **配色可以丰富但有纪律**:允许红/绿/橙/黄/紫/青等,用不同色相区分不同元素/曲线/对比,教学上更清楚。要点:
  ① 同一画面里同类元素用一致的色;② 主体用高对比亮色、辅助/背景/网格用低饱和中性色;③ **背景跟随当前主题(深色或浅色都可能),文字/主体必须与背景高对比**——浅色背景避免白/浅字,深色背景避免黑字(运行时已自动把 WHITE 等亮色在浅背景压暗,你也可直接选深色);④ 别让文字与底色或同色线混在一起。可参考官方 example 的多色用法。
- **与主题协调的调色板**(浅/深背景都清晰,整步风格统一即可):
  · 主体/高亮:`#4a9eff` 蓝、`#f6a04b` 橙、`#e05b5b` 红、`#54c58a` 绿(浅背景仍清晰)
  · 辅助/网格/次要:降饱和中性(深背景 `#5f7487`,浅背景 `#8896a6`)
  · 文字:深背景用浅色 `#e8edf2`,浅背景用深色 `#2b2b2b`
- 主体图形 strokeWidth 3-4;辅助线/标注 1-2 且用中性或浅色。
- **布局与层级(信息一眼可读)**:一图一主题,标题/轴标签/公式/主体分区摆放、留白、别贴边被裁切;字号分级(标题 > 轴标签/公式 > 说明);每步给一句话关键标注(概念名/公式/结论),别为凑数堆文字。
- 3D 场景的标题/标注用 `scene.addFixedInFrameMobjects(text)` 钉到屏幕帧;3D 对象(Dot3D/Sphere/Arrow3D)直接 `scene.add`。
- 涉及曲面/立体/三维空间(二次曲面、梯度下降损失面、向量三维、球体)用 ThreeDScene + Surface3D/Sphere/Arrow3D;其余用 2D Scene + Axes。
- 变量名 camelCase。可调参数用 `params.<name>`,在 params 数组里给出 min/max/step/default。
- **数学公式、数字等必须用 `MathTexImage`(首选,KaTeX 稳定)/`MathTex`/`Tex`**(真 LaTeX 渲染),不要把公式当普通文字塞进 Text;Text 只用于标题/说明/轴标签等普通文字。**含 `\overrightarrow`/`\mathcal`/花体等动态字体命令的公式一律用 MathTexImage**(MathTex 会触发 MathJax 异步字体加载失败)。若验证报 "公式渲染失败/MathJax" 就改 MathTexImage。formula 字段给 KaTeX 字符串(与 MathTexImage 的 latex 一致)。
- **字体**:所有 Text 用衬线宋体 `fontFamily: '"Times New Roman","SimSun",serif'`(中文 SimSun、英文/数字 Times New Roman)。不要用黑体/无衬线。

优先用最常见的写法:`new Create(...)`/`new FadeIn(...)`/`new Transform(...)`/`axes.plot(fn,{...})`/`axes.c2p(x,y)`/`mob.moveTo([...])`/`mob.nextTo(other,dir)`/`new VGroup(...)`。"""


# ---------- 可复用 prompt 块(从 STEP_PROMPT 切片抽出,保持同步;供 step_agent.py 组合)----------
def _split_step_prompt() -> dict:
    """把 STEP_PROMPT 按章节切片,返回各块文本。章节标题行格式:一、二、三、四、五、"""
    lines = STEP_PROMPT.split("\n")
    marks = {}
    for i, l in enumerate(lines):
        for key in ("一、", "二、", "三、", "四、", "五、"):
            if l.startswith(key):
                marks[key] = i
    def block(key, next_key):
        s = marks[key]
        e = marks.get(next_key, len(lines))
        return "\n".join(lines[s:e]).rstrip()
    return {
        "api_ref": block("二、", "三、"),
        "runtime_rules": block("三、", "四、"),
        "teaching_norms": block("五、", None),
    }


_BLOCKS = _split_step_prompt()
API_REF_BLOCK = _BLOCKS["api_ref"]
RUNTIME_RULES_BLOCK = _BLOCKS["runtime_rules"]
TEACHING_NORMS_BLOCK = _BLOCKS["teaching_norms"]


# ---------- 运行环境新能力(TS 容忍 + 可自建 scene)----------
# 运行时(前端 src/runScript.ts + manimCtx.exposeManimGlobals)已支持:
#   • TS 注解容忍:LLM 顺手带 `: number` 等运行时会自动剥掉,不必整段重写;
#   • 自建 scene:代码可 `new Scene(container,{相机/3D})` / `new ThreeDScene(container,...)`,
#     运行时给真 #container 并把 manim-web 全部导出铺到全局,import 也可用(会被剥掉)。
# 仍保留注入 scene 的默认写法(暂停/断点依赖);需要相机/3D/PiP 时才自建。
RUNTIME_POWER_BLOCK = """
• 你可以自建 scene:需要相机/3D/视角/PiP 时,直接在代码里 `new ThreeDScene(container, {...})`
  或 `new Scene(container, {...})` 自己建。
• 官方 manim-web 示例(下方"官方示例参考")就是"自建 scene + 可能写 TS"的写法,可照抄其 API 用法。
"""


# ---------- 官方 example 约 50%(few-shot 参考:自建 scene 风格)----------
# 从 tools/demo/_mw_exs 读取官方示例全文注入提示词,让 LLM 学到 manim-web 的真实 API 用法。
# 注:官方例子保留多色/无 fontFamily/自建场景,是 API 演示;你自己输出时仍要守教学规范
# (配色可丰富/fontFamily 中文/公式用 MathTexImage/自建或注入 scene 皆可)。
_OFFICIAL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "tools", "demo", "_mw_exs")
OFFICIAL_FEWSHOT_FILES = [
    "vector_arrow.ts", "sin_cos_plot.ts", "graph_area_plot.ts", "sine_curve_unit_circle.ts",
    "polygon_on_axes.ts", "moving_dots.ts", "point_moving_on_shapes.ts", "point_with_trace.ts",
    "rotation_updater.ts", "moving_angle.ts", "moving_group_to_destination.ts", "replacement_transform.ts",
    "text_transform.ts", "displaying_text.ts", "displaying_equations.ts", "brace_annotation.ts",
    "boolean_operations.ts", "heat_diagram_plot.ts", "moving_around.ts",
    "three_d_surface_plot.ts", "three_d_angle.ts", "three_d_camera_rotation.ts",
    "three_d_camera_illusion_rotation.ts", "three_d_light_source_position.ts",
    "mathtex_svg.ts", "mathtex_to_text_transform.ts", "easing_functions_showcase.ts",
    "rate_functions_comparison.ts", "manim_ce_logo.ts", "opening_manim.ts",
]


def _find_official_dir() -> str:
    # 从本文件逐级向上找含 tools/demo/_mw_exs 的目录(兼容主仓/工作树两种检出)
    cur = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for _ in range(6):
        cand = os.path.join(cur, "tools", "demo", "_mw_exs")
        if os.path.isdir(cand):
            return cand
        up = os.path.dirname(cur)
        if up == cur:
            break
        cur = up
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "tools", "demo", "_mw_exs")


_OFFICIAL_DIR = _find_official_dir()


def _load_official_fewshot(subset: Optional[list] = None) -> str:
    files = subset or OFFICIAL_FEWSHOT_FILES
    blocks = []
    for f in files:
        p = os.path.join(_OFFICIAL_DIR, f)
        try:
            with open(p, encoding="utf-8") as fh:
                blocks.append("/* 官方示例: %s */\n" % f + fh.read())
        except Exception:
            continue
    return "\n\n".join(blocks)


OFFICIAL_EXAMPLES_BLOCK = _load_official_fewshot()


def generate_step(
    step_title: str,
    outline_titles: list,
    prev_step: Optional[dict] = None,
    question: str = "",
    prev_error: Optional[str] = None,
    client: Optional["OpenAI"] = None,
    cfg: Optional[LLMConfig] = None,
) -> dict:
    """下游 agent:为单个子知识点设计完整 step(intent/formula/narration/params/sceneCode)。

    prev_step 为上一个已设计完的 step(含 title/narration/sceneCode),用于保持连续性。
    prev_error 非空时,提示 LLM 上次代码执行报错,要求修正。
    返回 dict:{title, intent, formula, narration, params, sceneCode}。
    """
    cfg = cfg or _get_runtime_cfg()
    outline_list = "\n".join(f"{i+1}. {t}" for i, t in enumerate(outline_titles))
    prev_ctx = "（这是第一个子知识点,无上文）"
    if prev_step:
        # A 方案:上游 step 存的是 sceneCode(manim-web TS 函数体),给 LLM 看以保持连续性
        prev_code = prev_step.get("sceneCode") or prev_step.get("pythonCode") or ""
        prev_ctx = (
            f"上一个子知识点:{prev_step.get('title','')}\n"
            f"上一步讲解:{prev_step.get('narration','')}\n"
            f"上一步动画代码(完整 manim-web TypeScript 函数体):\n{prev_code}\n"
            f"请在术语和画面上承接上文,可在前者基础上推进。"
        )
    user = (
        f"用户要学的总知识点:{question}\n\n"
        f"整体知识点拆解(供你把握全局):\n{outline_list}\n\n"
        f"现在请设计第 {step_title} 这个子知识点。\n\n"
        f"上文上下文:\n{prev_ctx}\n\n"
        f"输出该子知识点的完整设计 JSON。"
    )
    if prev_error:
        user += f"\n\n上一次生成的代码执行报错:{prev_error}\n请修正这个错误(尤其注意 API 用法和参数取值),重新生成。"
    raw = _call_llm(user, cfg, client, system_prompt=STEP_PROMPT)
    # 校验 + 补全
    if not isinstance(raw, dict):
        raise ValueError("step 设计返回非 JSON 对象")
    raw.setdefault("title", step_title)
    raw.setdefault("intent", "")
    raw.setdefault("formula", "")
    raw.setdefault("narration", "")
    raw.setdefault("params", [])
    raw.setdefault("pythonCode", "")
    raw.setdefault("sceneCode", "")
    # A 方案:LLM 直接输出 manim-web TS 函数体作为 sceneCode,不再走 py2ts 转换器。
    # 转换器路线已废弃(代码保留在 py2ts.py / py2ts_adapter.py 作备份,如需回滚见 manim_lesson.py.bak2)。
    # 若 LLM 误把代码放进 pythonCode(旧习惯),兜底挪到 sceneCode。
    if not raw.get("sceneCode") and raw.get("pythonCode"):
        raw["sceneCode"] = raw["pythonCode"]
        raw["pythonCode"] = ""
    return raw






def _call_vision_llm(prompt: str, image_base64: str, cfg: "LLMConfig") -> str:
    """调视觉模型描述一张图像(base64 PNG),返回纯文本描述。
    用于 update_animation 通过后的画面自检(主模型无视觉时,借辅助视觉模型)。
    走 OpenAI 兼容 image_url 格式。失败返回空串(不阻塞定稿)。"""
    if OpenAI is None or not cfg or not cfg.base_url or not cfg.model:
        return ""
    try:
        client = OpenAI(base_url=cfg.base_url, api_key=cfg.api_key or "dummy")
        data_url = f"data:image/png;base64,{image_base64}"
        resp = client.chat.completions.create(
            model=cfg.model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }],
            temperature=0.2,
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception as e:
        # 视觉检查失败不阻塞:返回空串,update_animation 按无描述处理
        import sys as _sys
        print(f"[vision] _call_vision_llm 失败:{type(e).__name__}: {e}", file=_sys.stderr)
        return ""


# ---------- LangChain/LangGraph tool 包装(可选,框架存在时才生效)----------

def as_langchain_tool():
    """把 generate_lesson 包装成 LangChain @tool,供 LangGraph agent 调用。

    需要 langchain-core 已安装;否则抛出友好错误。
    """
    if _lc_tool is None:
        raise ImportError("langchain-core 未安装,无法包装为 LangChain tool")

    @_lc_tool("generate_lesson")
    def _generate_lesson_tool(question: str, file_text: Optional[str] = None) -> dict:
        """根据用户的 STEM 知识点问题(可附文件文本),生成一套 5-7 步的可交互教学动画脚本。

        Args:
            question: 用户要学的知识点或问题
            file_text: 可选,用户上传文件的文本内容
        Returns:
            Lesson JSON dict(title/summary/params/steps)
        """
        return generate_lesson(question, file_text)

    return _generate_lesson_tool


