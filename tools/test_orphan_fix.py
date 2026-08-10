#!/usr/bin/env python3
"""单元验证 _has_orphan_tool_call 修复:模拟多 tool_call 单 ToolMessage 的场景。"""
import sys
sys.path.insert(0, "backend")
# 导入修复后的函数(不触发 Django/LLM)
from skill.main_agent import _has_orphan_tool_call

# 用真实类模拟 langgraph 消息(AIMessage/ToolMessage/HumanMessage),函数靠 type(m).__name__ 判断
class AIMessage:
    def __init__(self, tool_calls=None):
        self.tool_calls = tool_calls or []
        self.content = ""

class ToolMessage:
    def __init__(self, tool_call_id):
        self.tool_call_id = tool_call_id

class HumanMessage:
    def __init__(self):
        self.content = "hi"

def tc(tid):
    return {"id": tid, "name": "x"}

def test(name, cond):
    print(f"{'PASS' if cond else 'FAIL'} | {name}")
    return cond

all_ok = True

# 场景1:单个 tool_call + 有 ToolMessage → 无孤儿
msgs = [AIMessage(tool_calls=[tc("a")]), ToolMessage("a")]
all_ok &= test("单工具正常(无孤儿)", _has_orphan_tool_call(msgs) is False)

# 场景2:单个 tool_call(interrupt)+ 无 ToolMessage → 有孤儿
msgs = [AIMessage(tool_calls=[tc("a")])]
all_ok &= test("单工具 interrupt(有孤儿)", _has_orphan_tool_call(msgs) is True)

# 场景3(Bug1 核心):两个 tool_call 同 AIMessage,一个无 ToolMessage → 必须判孤儿
msgs = [AIMessage(tool_calls=[tc("switch_stage"), tc("generate_animation")]), ToolMessage("switch_stage")]
# 旧实现:any() 命中 switch_stage → 返回 False(漏判);新实现:generate_animation 无 TM → True
all_ok &= test("多工具同批部分中断(必须判孤儿)", _has_orphan_tool_call(msgs) is True)

# 场景4:两个 tool_call 都有 ToolMessage → 无孤儿
msgs = [AIMessage(tool_calls=[tc("a"), tc("b")]), ToolMessage("a"), ToolMessage("b")]
all_ok &= test("多工具全部完成(无孤儿)", _has_orphan_tool_call(msgs) is False)

# 场景5:空历史 → 无孤儿
all_ok &= test("空历史(无孤儿)", _has_orphan_tool_call([]) is False)

# 场景6:多个 AIMessage,第一个有孤儿,后面正常
msgs = [AIMessage(tool_calls=[tc("orphan")]), ToolMessage("other"), AIMessage(tool_calls=[tc("x")]), ToolMessage("x")]
all_ok &= test("历史中任意孤儿都该判 True", _has_orphan_tool_call(msgs) is True)

print()
print("ALL PASS" if all_ok else "SOME FAILED")
