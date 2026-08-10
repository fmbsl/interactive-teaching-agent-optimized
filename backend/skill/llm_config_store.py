"""LLM 接入点配置的运行时存储与持久化。

支持多个接入点(base_url/api_key/model + fallback),存 backend/llm_endpoints.json。
首次运行(文件不存在)从 .env 迁移一个 default 条目,不丢现有配置。
get_active_config() 返回当前启用接入点对应的 LLMConfig;manim_lesson 的生成函数
未显式传 cfg 时走它,实现"改完立即生效"。
"""
from __future__ import annotations
import json
import os
import threading
import uuid
from typing import Optional

# 确保 .env 已加载(纯 Python 调用/迁移时也读得到;Django settings 已 load 过,幂等)
try:
    from dotenv import load_dotenv as _load_dotenv
    _load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except Exception:
    pass

from .manim_lesson import LLMConfig, _default_config

# backend/ 目录(skill 的上两级)
_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_CONFIG_PATH = os.path.join(_BACKEND_DIR, "llm_endpoints.json")

_lock = threading.Lock()
_active_cfg: Optional[LLMConfig] = None


def _load_raw() -> dict:
    """读 llm_endpoints.json;不存在返回空结构。"""
    if not os.path.exists(_CONFIG_PATH):
        return {"activeId": None, "endpoints": []}
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"activeId": None, "endpoints": []}
        data.setdefault("activeId", None)
        data.setdefault("endpoints", [])
        return data
    except (json.JSONDecodeError, OSError):
        return {"activeId": None, "endpoints": []}


def _save_raw(data: dict) -> None:
    tmp = _CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _CONFIG_PATH)  # 原子写


def _migrate_from_env() -> dict:
    """首次运行:从 .env 读当前配置生成 default 条目。"""
    cfg = _default_config()
    ep = {
        "id": "default",
        "name": "default",
        "baseUrl": cfg.base_url,
        "apiKey": cfg.api_key,
        "model": cfg.model,
        "fallbackModel": cfg.model_fallback or "",
        "fallbackBaseUrl": cfg.fallback_base_url or "",
        "fallbackApiKey": cfg.fallback_api_key or "",
        "supportsVision": False,
    }
    data = {"activeId": "default", "endpoints": [ep]}
    _save_raw(data)
    return data


def _endpoint_to_cfg(ep: dict) -> LLMConfig:
    return LLMConfig(
        base_url=ep.get("baseUrl", ""),
        api_key=ep.get("apiKey", ""),
        model=ep.get("model", ""),
        model_fallback=ep.get("fallbackModel") or None,
        fallback_base_url=ep.get("fallbackBaseUrl") or None,
        fallback_api_key=ep.get("fallbackApiKey") or None,
        supports_vision=bool(ep.get("supportsVision", False)),
        reasoning_effort=ep.get("reasoningEffort", "high") or "high",
    )


def _get_vision_cfg() -> Optional[LLMConfig]:
    """返回视觉辅助模型的 LLMConfig(顶层 visionEndpoint)。未配置返回 None。
    主模型 supports_vision=False 时,update_animation 通过后用这个模型描述画面。"""
    data = _load_raw()
    ve = data.get("visionEndpoint")
    if not ve or not ve.get("baseUrl") or not ve.get("model"):
        return None
    return LLMConfig(
        base_url=ve.get("baseUrl", ""),
        api_key=ve.get("apiKey", ""),
        model=ve.get("model", ""),
    )


def save_vision_endpoint(ep: dict) -> dict:
    """保存视觉辅助模型配置(顶层 visionEndpoint,单条)。apiKey 掩码/空时保留原值。"""
    with _lock:
        data = _load_raw()
        prev = data.get("visionEndpoint") or {}
        ep = {**ep}
        if not ep.get("apiKey") or str(ep.get("apiKey", "")).startswith("••••"):
            ep["apiKey"] = prev.get("apiKey", "")
        data["visionEndpoint"] = ep
        _save_raw(data)
        _invalidate()
    return data


def get_vision_endpoint() -> dict:
    """返回当前 visionEndpoint(给前端展示)。"""
    data = _load_raw()
    return data.get("visionEndpoint") or {}


def get_active_config() -> LLMConfig:
    """返回当前启用接入点的 LLMConfig。无配置时回退 _default_config()(读 .env)。"""
    global _active_cfg
    if _active_cfg is not None:
        return _active_cfg
    with _lock:
        if _active_cfg is not None:
            return _active_cfg
        data = _load_raw()
        if not data["endpoints"]:
            data = _migrate_from_env()
        active_id = data.get("activeId")
        ep = next((e for e in data["endpoints"] if e.get("id") == active_id), None)
        if ep is None and data["endpoints"]:
            ep = data["endpoints"][0]  # activeId 失效时退回首条
        if ep is None:
            _active_cfg = _default_config()
        else:
            _active_cfg = _endpoint_to_cfg(ep)
    return _active_cfg


def _invalidate() -> None:
    """配置变更后清缓存,下次 get_active_config 重新读。"""
    global _active_cfg
    _active_cfg = None


def _mask_key(k: str) -> str:
    """掩码 apiKey:只留后 4 位,其余 ••••。空则原样空。"""
    if not k:
        return ""
    if len(k) <= 6:
        return "••••"
    return "••••" + k[-4:]


def _masked_ep(ep: dict) -> dict:
    """返回掩码后的端点 dict(只给前端展示用,真实 key 仍只存服务端)。"""
    e = dict(ep)
    if e.get("apiKey"):
        e["apiKey"] = _mask_key(e["apiKey"])
    if e.get("fallbackApiKey"):
        e["fallbackApiKey"] = _mask_key(e["fallbackApiKey"])
    return e


def list_endpoints() -> dict:
    """返回 {activeId, endpoints, visionEndpoint},apiKey 一律掩码(不把明文 key 下发前端)。"""
    data = _load_raw()
    if not data["endpoints"]:
        data = _migrate_from_env()
    out = {**data}
    out["endpoints"] = [_masked_ep(e) for e in data["endpoints"]]
    if out.get("visionEndpoint"):
        out["visionEndpoint"] = _masked_ep(out["visionEndpoint"])
    return out


def save_endpoint(ep: dict) -> dict:
    """新增或更新(id 为空则生成新 id)。返回更新后的 {activeId, endpoints}。
    前端 GET 到的是掩码 key;若保存时 apiKey 为空或以 •••• 开头,视为"未改动",保留服务端原 key。"""
    with _lock:
        data = _load_raw()
        if not data["endpoints"] and not ep.get("id"):
            data = _migrate_from_env()
        eid = ep.get("id") or uuid.uuid4().hex[:8]
        # apiKey / fallbackApiKey 未改动时保留原值(前端保存的是掩码占位或空)
        prev = next((e for e in data["endpoints"] if e.get("id") == eid), None)
        for f in ("apiKey", "fallbackApiKey"):
            v = ep.get(f, "")
            if prev is not None and (not v or str(v).startswith("••••")):
                ep = {**ep, f: prev.get(f, "")}
        ep = {**ep, "id": eid}
        if prev is not None:
            data["endpoints"][data["endpoints"].index(prev)] = ep
        else:
            data["endpoints"].append(ep)
        if data.get("activeId") is None:
            data["activeId"] = eid  # 首个自动启用
        _save_raw(data)
        _invalidate()
    return data


def delete_endpoint(eid: str) -> dict:
    with _lock:
        data = _load_raw()
        data["endpoints"] = [e for e in data["endpoints"] if e.get("id") != eid]
        if data.get("activeId") == eid:
            data["activeId"] = data["endpoints"][0]["id"] if data["endpoints"] else None
        _save_raw(data)
        _invalidate()
    return data


def set_active(eid: str) -> dict:
    with _lock:
        data = _load_raw()
        if any(e.get("id") == eid for e in data["endpoints"]):
            data["activeId"] = eid
            _save_raw(data)
        _invalidate()
    return data
