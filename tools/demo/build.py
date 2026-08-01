"""构建独立 3D demo:用新 py2ts.py(AST) 转换 demo3d.py -> 包装 -> src/demo/sceneCode.ts。

走和后端适配器一致的 _parse_ts_output + _post_process_body,但转换器换成新的 py2ts.py
(后端适配器仍指向旧 py2ts.cjs,这里独立调新转换器以验证其输出)。
"""
import os
import sys
import json
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))
from skill.py2ts_adapter import _parse_ts_output, _post_process_body  # noqa: E402

PY2TS = os.path.join(ROOT, "tools", "py2ts.py")
SRC = os.path.join(ROOT, "tools", "demo", sys.argv[1] if len(sys.argv) > 1 else "demo3d.py")
OUT = os.path.join(ROOT, "src", "demo", "sceneCode.ts")


def run_new_converter(python_code: str) -> str:
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    proc = subprocess.run(
        [sys.executable, PY2TS],
        input=python_code, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=30, cwd=ROOT, env=env,
    )
    # 0 = 成功; 2 = 成功+警告; 1 = 解析错
    if proc.returncode not in (0, 2):
        raise RuntimeError(f"py2ts.py 失败 rc={proc.returncode}: {proc.stderr.strip()[:500]}")
    if proc.stderr.strip():
        sys.stderr.write("[py2ts.py 警告]\n" + proc.stderr + "\n")
    return proc.stdout


def main():
    py = open(SRC, encoding="utf-8").read()
    ts = run_new_converter(py)
    imports, body = _parse_ts_output(ts)
    if not body:
        raise RuntimeError("未提取到函数体")
    body = _post_process_body(body)
    # 包装成前端可执行: const { ...imports, scene } = ctx; <body>
    need = ["scene"] + [i for i in imports if i != "scene"]
    seen, uniq = set(), []
    for n in need:
        if n not in seen:
            seen.add(n)
            uniq.append(n)
    destructure = "const { " + ", ".join(uniq) + " } = ctx;"
    if ("params." in body or "params," in body or "params }" in body) and "params" not in seen:
        destructure = "const { " + ", ".join(uniq) + ", params } = ctx;"
    if "matMul(" in body and "matMul" not in destructure:
        destructure = destructure.replace(" } = ctx;", ", matMul } = ctx;")
    if "np." in body and " np" not in destructure:
        destructure = destructure.replace(" } = ctx;", ", np } = ctx;")
    code = destructure + "\n" + body
    open(OUT, "w", encoding="utf-8").write(
        f"// 由 tools/demo/build.py 从 {os.path.basename(SRC)} 经 py2ts.py(AST) 转换生成。勿手改。\n"
        "export const SCENE_CODE = " + json.dumps(code) + ";\n"
    )
    sys.stderr.write(f"[build] 写出 {OUT} ({len(code)} 字符)\n")
    sys.stderr.write("[build] 转换后代码:\n" + code + "\n")


if __name__ == "__main__":
    main()
