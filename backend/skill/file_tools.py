"""文件读取工具(仿 Claude Code 的 Read / Grep)。

主 agent 用这两个工具按需读用户上传的文件片段,不全量塞上下文。
- read(file_id, offset, limit):带行号读片段(offset 1-based 起始行,limit 行数)。支持 txt/md/pdf。
- grep(pattern, file_id):正则搜,返回匹配行+行号。

文件路径从 session.files 元数据取(agent.get_file_meta),工具不直接收路径(防越权)。
"""
from __future__ import annotations
import re
import os
from typing import Optional


# ---------- 文本提取(支持 txt/md/pdf) ----------

def _extract_text(path: str) -> str:
    """从文件提取纯文本。txt/md 直接读;pdf 用 pdfplumber。提取结果缓存到同目录 .txt 加速。"""
    cache = path + ".txt"
    if os.path.exists(cache):
        try:
            with open(cache, encoding="utf-8") as f:
                return f.read()
        except Exception:
            pass
    ext = os.path.splitext(path)[1].lower()
    text = ""
    try:
        if ext == ".pdf":
            try:
                import pdfplumber
                with pdfplumber.open(path) as pdf:
                    text = "\n".join((pg.extract_text() or "") for pg in pdf.pages)
            except Exception:
                text = ""
        else:
            # txt/md/其它文本:尝试 utf-8,失败回退 gbk
            try:
                with open(path, encoding="utf-8") as f:
                    text = f.read()
            except UnicodeDecodeError:
                with open(path, encoding="gbk", errors="replace") as f:
                    text = f.read()
    except Exception:
        text = ""
    # 写缓存(仅当提取成功)
    if text:
        try:
            with open(cache, "w", encoding="utf-8") as f:
                f.write(text)
        except Exception:
            pass
    return text


# ---------- Read:带行号读片段(仿 Claude Code) ----------

def read_file(path: str, offset: int = 0, limit: int = 100) -> str:
    """读文件片段,返回带行号的内容。offset=起始行(0 或 1 都视作从头),limit=读多少行。
    和 Claude Code Read 一致:行号从 1 开始,格式 `  N\t内容`。"""
    text = _extract_text(path)
    if not text:
        return f"(无法从 {os.path.basename(path)} 提取文本,可能是空文件或 PDF 无文字层)"
    lines = text.split("\n")
    start = max(0, offset) if offset > 0 else 0
    # offset 1-based 友好:用户传 1 表示第 1 行,转 0-based 是 0
    if offset >= 1:
        start = offset - 1
    end = min(len(lines), start + max(1, limit))
    out = []
    for i in range(start, end):
        out.append(f"{i+1:>5}\t{lines[i]}")
    header = f"[{os.path.basename(path)} 行 {start+1}-{end} / 共 {len(lines)} 行]"
    return header + "\n" + "\n".join(out)


# ---------- Grep:正则搜(仿 Claude Code) ----------

def grep_file(path: str, pattern: str, context: int = 0) -> str:
    """在文件里正则搜索,返回匹配行+行号。context=前后各显示的行数(0=只匹配行)。
    和 Claude Code Grep 一致:返回 `行号:内容`。"""
    text = _extract_text(path)
    if not text:
        return f"(无法从 {os.path.basename(path)} 提取文本)"
    lines = text.split("\n")
    try:
        rx = re.compile(pattern)
    except re.error as e:
        return f"正则编译失败:{e}"
    matches = [i for i, ln in enumerate(lines) if rx.search(ln)]
    if not matches:
        return f"[{os.path.basename(path)}] 无匹配(pattern={pattern!r})"
    # 收集结果(带 context,去重保序)
    shown: set[int] = set()
    out_lines = []
    for idx in matches:
        lo = max(0, idx - context)
        hi = min(len(lines) - 1, idx + context)
        for i in range(lo, hi + 1):
            if i in shown:
                continue
            shown.add(i)
            mark = ">" if i == idx else " "
            out_lines.append(f"{mark}{i+1:>4}: {lines[i]}")
    header = f"[{os.path.basename(path)}] 匹配 {len(matches)} 处:"
    return header + "\n" + "\n".join(out_lines)
