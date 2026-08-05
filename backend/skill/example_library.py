"""step_agent 的范例检索库:按 query 在模板库(人工手写 + 官方 manim-web)里检索最相关范例。

数据来源:backend/skill/examples.json(由 tools/dump_examples 从
src/templates/library.ts + src/templates/official.ts 生成,详见库顶部注释)。

检索:轻量关键词加权(domain/category/title/intent 命中加分),返回 top-N 个含完整
sceneCode 的范例文本,供 step_agent 学习对应概念的动画写法和交互/分镜手法。
"""
import json
import os
import re

_EXAMPLES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "examples.json")
_EXAMPLES: list = None  # 懒加载缓存


def _load() -> list:
    global _EXAMPLES
    if _EXAMPLES is None:
        try:
            with open(_EXAMPLES_PATH, encoding="utf-8") as f:
                _EXAMPLES = json.load(f)
        except Exception:
            _EXAMPLES = []
    return _EXAMPLES


def _score(query_words: list, e: dict) -> int:
    hay = " ".join([
        str(e.get("domain", "")), str(e.get("category", "")),
        str(e.get("title", "")), str(e.get("intent", "")),
    ]).lower()
    title = str(e.get("title", "")).lower()
    s = 0
    for w in query_words:
        if w in hay:
            s += 2
        if w in title:
            s += 1
    return s


def lookup_example(query: str, n: int = 3) -> str:
    """在范例库检索与 query 最相关的 n 个范例,返回格式化文本(含完整 sceneCode)供 LLM 参考。"""
    ex = _load()
    if not ex:
        return "(范例库为空:backend/skill/examples.json 缺失或为空)"
    q = (query or "").lower()
    # 中英文都拆词:字母数字连串 + 中文按字(词)粗略拆
    words = [w for w in re.split(r"[\s,，。;；:：()（）]+", q) if w]
    pure_cn = re.findall(r"[一-鿿]{2,}", q)
    words += pure_cn
    words = [w for w in words if len(w) >= 1]
    if not words:
        return "(查询为空,请提供知识点/意图关键词)"

    scored = sorted(ex, key=lambda e: -_score(words, e))
    top = [e for e in scored if _score(words, e) > 0][:n]
    if not top:
        top = scored[:n]  # 全不命中时也返回前 n 个,别让 LLM 空手
    out = []
    for i, e in enumerate(top, 1):
        out.append(
            f"【范例 {i}】{e.get('domain') or '?'} · {e.get('category') or ''} · {e.get('title') or ''}\n"
            f"  意图:{e.get('intent') or ''}\n"
            f"  代码:\n{e.get('sceneCode') or '(无代码)'}"
        )
    return "\n\n".join(out)