"""孤儿 tool_call 检测(:防 INVALID_CHAT_HISTORY)。"""
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from skill.main_agent import _has_orphan_tool_call


def test_orphan_true_unanswered_tool():
    h = [
        HumanMessage(content="出题"),
        AIMessage(content="", tool_calls=[{"name": "generate_quiz", "args": {}, "id": "call_1", "type": "tool_call"}]),
    ]
    assert _has_orphan_tool_call(h) is True


def test_false_when_answered():
    h = [
        HumanMessage(content="出题"),
        AIMessage(content="", tool_calls=[{"name": "generate_quiz", "args": {}, "id": "call_1", "type": "tool_call"}]),
        ToolMessage(content="用户答对", tool_call_id="call_1"),
    ]
    assert _has_orphan_tool_call(h) is False


def test_false_plain_text():
    assert _has_orphan_tool_call([HumanMessage(content="hi"), AIMessage(content="你好")]) is False


def test_false_empty():
    assert _has_orphan_tool_call([]) is False
