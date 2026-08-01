#!/usr/bin/env python3
# py2ts_ast.py — Python Manim to AST JSON
# Converts Python source to a structured AST for the ast2ts.cjs transpiler.

import ast
import json
import sys
from pathlib import Path


def node_to_dict(node):
    """Recursively convert an ast.AST node into a plain dict."""
    if isinstance(node, ast.AST):
        result = {"_type": type(node).__name__}
        for field, value in ast.iter_fields(node):
            result[field] = node_to_dict(value)
        return result
    elif isinstance(node, list):
        return [node_to_dict(item) for item in node]
    elif isinstance(node, (str, int, float, bool, type(None))):
        return node
    else:
        return repr(node)


def extract_source_segment(source_lines, node):
    """Extract the original source code for a node (for debugging)."""
    try:
        return ast.get_source_segment(source_lines, node) or ""
    except Exception:
        return ""


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
        print("py2ts_ast.py — Convert Python Manim to AST JSON")
        print("Usage:")
        print("  python tools/py2ts_ast.py input.py > ast.json")
        print("  cat input.py | python tools/py2ts_ast.py > ast.json")
        sys.exit(0)

    # Read source
    if len(sys.argv) > 1:
        source_path = Path(sys.argv[1])
        source = source_path.read_text(encoding="utf-8")
    else:
        source = sys.stdin.read()

    source_lines = source.splitlines(keepends=True)

    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        print(f"SyntaxError: {e}", file=sys.stderr)
        sys.exit(1)

    ast_dict = node_to_dict(tree)

    # Augment with source segments for nodes that need raw text (lambdas, complex exprs)
    def add_source_segments(node):
        if isinstance(node, dict) and "_type" in node:
            if node["_type"] in ("Lambda", "Compare", "BoolOp", "BinOp", "IfExp", "ListComp", "DictComp", "GeneratorExp", "Await", "FormattedValue"):
                # We don't have the original node here, so just mark that we want source
                node["_want_source"] = True
            for value in node.values():
                add_source_segments(value)
        elif isinstance(node, list):
            for item in node:
                add_source_segments(item)

    add_source_segments(ast_dict)

    output = {
        "ast": ast_dict,
        "source": source,
        "metadata": {
            "python_version": sys.version,
            "tool": "py2ts_ast",
        }
    }

    json.dump(output, sys.stdout, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
