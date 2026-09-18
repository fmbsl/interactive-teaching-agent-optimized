"""Versioned browser verification protocol; unknown/legacy success fails closed."""
import hashlib
import math

REQUIRED_CHECKS = {"execution", "scene-access", "measurements", "mathtex", "nan", "layout-final", "bounds-final", "layout-temporal"}
LAYOUT_CHECKS = {"layout-final", "bounds-final", "layout-temporal"}
SKIPPABLE_CHECKS = REQUIRED_CHECKS - {"execution"}
STATUSES = {"passed", "failed", "incomplete", "cancelled"}


def _sampling(value):
    if not isinstance(value, dict) or value.get('mode') != 'real-playback':
        return None
    fields = ['intervalMs', 'samples', 'maxGapMs']
    if any(type(value.get(k)) not in (int, float) or not math.isfinite(value[k]) or value[k] < 0 for k in fields):
        return None
    return {k: value[k] for k in ['mode'] + fields}


def _diagnostics(values, declaration=False):
    if not isinstance(values, list):
        return []
    result = []
    for value in values[:30 if declaration else 3]:
        if not isinstance(value, dict):
            continue
        objects = value.get('objects')
        if not isinstance(objects, list) or not objects or any(not isinstance(s, str) for s in objects):
            continue
        if any(type(value.get(k)) not in (int, float) or not math.isfinite(value[k]) for k in ['start','end']):
            continue
        item = {'objects': [s[:120] for s in objects[:2]], 'start':value['start'], 'end':value['end']}
        if declaration:
            item['reason'] = str(value.get('reason',''))[:300]
        else:
            item.update(key=str(value.get('key',''))[:250], type=str(value.get('type',''))[:30],
                        message=str(value.get('message',''))[:1000], scene=value.get('scene') if type(value.get('scene')) is int else 0)
            bounds = value.get('bounds')
            item['bounds'] = [{k:b[k] for k in ['left','right','top','bottom']} for b in bounds[:2]
                              if isinstance(b,dict) and all(type(b.get(k)) in (int,float) and math.isfinite(b[k]) for k in ['left','right','top','bottom'])] if isinstance(bounds,list) else []
        result.append(item)
    return result


def code_version(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def normalize_verification(report, legacy_ok=False, error="", expected_code=""):
    if not isinstance(report, dict):
        return {"schemaVersion": 1, "status": "failed" if legacy_ok is False else "incomplete",
                "ok": False, "error": error or "旧客户端未提供完整验证报告，请更新页面后重试",
                "codeVersion": "", "checks": [], "missing": sorted(REQUIRED_CHECKS)}
    out = {k: report.get(k) for k in ("schemaVersion", "status", "codeVersion", "checks", "missing")}
    out["params"] = report.get("params", {})
    out["error"] = str(report.get("error") or error or "")
    out['sampling'] = _sampling(report.get('sampling'))
    # Diagnostic data is bounded; only normalized status/coverage can authorize a commit.
    out['layoutIssues'] = _diagnostics(report.get('layoutIssues'))
    out['overlapDeclarations'] = _diagnostics(report.get('overlapDeclarations'), declaration=True)
    valid_lists = all(isinstance(out[k], list) and all(isinstance(v, str) for v in out[k]) for k in ("checks", "missing"))
    if out["schemaVersion"] != 1 or not isinstance(out["status"], str) or out["status"] not in STATUSES or not valid_lists:
        return {"schemaVersion": 1, "status": "incomplete", "ok": False, "error": "验证协议或状态不受支持",
                "codeVersion": "", "checks": [], "missing": sorted(REQUIRED_CHECKS)}
    if out["status"] == "passed":
        checks = set(out["checks"])
        skipped_3d_layout = "3d-layout-skipped" in checks
        display_fallback = "display-fallback" in checks
        layout_warning = "layout-warning" in checks
        user_skipped = {
            value.split(":", 1)[1] for value in checks
            if value.startswith("user-skipped:") and value.split(":", 1)[1] in SKIPPABLE_CHECKS
        }
        relaxed_layout = skipped_3d_layout or display_fallback or layout_warning
        required = (REQUIRED_CHECKS - LAYOUT_CHECKS if relaxed_layout else REQUIRED_CHECKS) - user_skipped
        absent = required - checks
        ignored_missing = {"optional-visual-frame"} | user_skipped | (LAYOUT_CHECKS if relaxed_layout else set())
        absent.update(v for v in out["missing"] if v not in ignored_missing)
        sampling = out['sampling']
        if "layout-temporal" in required and not relaxed_layout and (not sampling or sampling['intervalMs'] != 80 or sampling['samples'] < 1 or sampling['maxGapMs'] > 320):
            absent.add('layout-temporal')
        if out["codeVersion"] != code_version(expected_code):
            absent.add("code-version")
        if absent:
            out.update(status="incomplete", error="验证覆盖不足：" + ", ".join(sorted(absent)))
            out["missing"] = sorted(set(out["missing"]) | absent)
    out["ok"] = out["status"] == "passed"
    return out
