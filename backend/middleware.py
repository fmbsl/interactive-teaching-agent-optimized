"""全局访问令牌鉴权(可选开关,用于安全地把后端暴露到局域网/公网)。

机制:
- token 存 backend/access_token.txt,首次启动自动生成(secrets.token_urlsafe),不重复覆盖。
- 所有 /api/ 请求(除 /api/health)必须带 `Authorization: Bearer <token>` 或 `?token=`,否则 401。
- 未读到 token 文件时不拦截(直通)——便于本地无鉴权开发;只要 access_token.txt 存在即强制鉴权。

注意:这是"挡陌生人"的轻量门禁,不是完整用户体系。别在上面放真正敏感的数据。
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
    """首次生成 token 并落盘(幂等:已存在不覆盖)。"""
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
        _issue_token()

    def __call__(self, request):
        path = request.path.rstrip("/") or "/"
        if path.startswith("/api") and path != "/api/health":
            token = get_access_token()
            if token is not None:
                # CORS 预检放行(corsheaders 已先处理;这里兜底)
                if request.method == "OPTIONS":
                    return self.get_response(request)
                auth = request.headers.get("Authorization", "")
                provided = auth[7:].strip() if auth.startswith("Bearer ") else request.GET.get("token", "")
                if provided and secrets.compare_digest(provided, token):
                    return self.get_response(request)
                return JsonResponse({"error": "unauthorized: 需要有效的访问令牌(Access Token)"}, status=401)
        return self.get_response(request)