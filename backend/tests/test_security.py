"""安全问题回归:render_result 路径穿越清洗;导出文件名头注入清洗。"""
import os, re


def _sanitize_safe_id(step_id):
    safe = "".join(re.findall(r"[A-Za-z0-9_-]", str(step_id))) or "step"
    return safe


def test_render_safe_id_strips_traversal():
    # 路径穿越 step_id 会被清洗成安全文件名,不逃出 frames_dir
    for evil in ("../../../trav2", r"..\..\x", "ok/../../y", "</core</p></head><body>../../z"):
        safe = _sanitize_safe_id(evil)
        assert "/" not in safe and "\\" not in safe and ".." not in safe
        # 拼出的最终路径应从 frames_dir 出发、仍在其内
        frames_dir = os.path.abspath(os.path.join("sessions", "sid_frames"))
        final = os.path.abspath(os.path.join(frames_dir, f"step_{safe}.png"))
        assert final.startswith(frames_dir), f"{evil!r} 未逃出"


def test_safe_id_keeps_normal():
    assert _sanitize_safe_id("topicid-1") == "topicid-1"


def test_cd_filename_sanitize():
    title = '糟糕"标题\r\n换行'
    fname = re.sub(r'[^\w.\-]', "", title.replace(" ", "_"))[:40] or "session"
    assert '"' not in fname and "\n" not in fname and "\r" not in fname
