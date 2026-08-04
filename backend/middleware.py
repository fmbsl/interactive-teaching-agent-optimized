"""全局访问令牌鉴权。

⚠️ 已按用户要求【关闭】:本中间件现在对 /api 一律放行,不拦截、不自动生成 token。
要恢复:把 __call__ 改回"检查 Authorization/CORS"的逻辑即可(见 git 历史 / 本文件注释)。
"""
import os
import secrets
from django.http import JsonResponse

_BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))
_TOKEN_FILE = os.path.join(_BACKEND_DIR, "access_token.txt")


def get_access_token():
    """读 token;文件存在且有内容则返回字符串,否则返回 None(=未开启鉴权)。"""
    try:
        if os.path.exists(_TOKEN_FILE):
            t = open(_TOKEN_FILE, encoding="utf-8").read().strip()
            return t or None
    except OSError:
        pass
    return None


def _issue_token():
    """(关闭状态不再调用)首次生成 token 并落盘(幂等:已存在不覆盖)。"""
    if os.path.exists(_TOKEN_FILE):
        return
    t = secrets.token_urlsafe(24)
    try:
        with open(_TOKEN_FILE, "w", encoding="utf-8") as f:
            f.write(t + "\n")
        import sys
        print(f"\n[access] 已为本后端生成访问令牌(见 backend/access_token.txt): {t}\n", file=sys.stderr)
    except OSError:
        pass


class AccessTokenMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        # 鉴权已关闭:不再自动生成/强制 token

    def __call__(self, request):
        # 鉴权关闭:所有请求直接放行。
        return self.get_response(request)
        return self.get_response(request)