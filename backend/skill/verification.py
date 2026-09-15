"""Versioned browser verification protocol; unknown/legacy success fails closed."""
import hashlib

REQUIRED_CHECKS = {"execution", "scene-access", "measurements", "mathtex", "nan", "layout-final", "bounds-final"}
STATUSES = {"passed", "failed", "incomplete", "cancelled"}


def code_version(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def normalize_verification(report, legacy_ok=False, error="", expected_code=""):
    if not isinstance(report, dict):
        return {"schemaVersion": 1, "status": "failed" if legacy_ok is False else "incomplete",
                "ok": False, "error": error or "旧客户端未提供完整验证报告，请更新页面后重试",
                "codeVersion": "", "checks": [], "missing": sorted(REQUIRED_CHECKS)}
    out = {k: report.get(k) for k in ("schemaVersion", "status", "codeVersion", "checks", "missing")}
    out["error"] = str(report.get("error") or error or "")
    valid_lists = all(isinstance(out[k], list) and all(isinstance(v, str) for v in out[k]) for k in ("checks", "missing"))
    if out["schemaVersion"] != 1 or not isinstance(out["status"], str) or out["status"] not in STATUSES or not valid_lists:
        return {"schemaVersion": 1, "status": "incomplete", "ok": False, "error": "验证协议或状态不受支持",
                "codeVersion": "", "checks": [], "missing": sorted(REQUIRED_CHECKS)}
    if out["status"] == "passed":
        absent = REQUIRED_CHECKS - set(out["checks"])
        absent.update(v for v in out["missing"] if v != "optional-visual-frame")
        if out["codeVersion"] != code_version(expected_code):
            absent.add("code-version")
        if absent:
            out.update(status="incomplete", error="验证覆盖不足：" + ", ".join(sorted(absent)))
            out["missing"] = sorted(set(out["missing"]) | absent)
    out["ok"] = out["status"] == "passed"
    return out
