from django.urls import path
from api.views import start, next_step, prev_step, goto_step, update, regenerate, render_result, upload, sessions, session_detail, trace, export_session, import_session, health, llm_config, decompose, decompose_trace

urlpatterns = [
    path("", health, name="health"),
    path("api/health", health, name="api-health"),
    path("api/start", start, name="start"),
    path("api/next", next_step, name="next"),
    path("api/prev", prev_step, name="prev"),
    path("api/goto", goto_step, name="goto"),
    path("api/update", update, name="update"),
    path("api/regenerate", regenerate, name="regenerate"),
    path("api/render_result", render_result, name="render-result"),
    path("api/upload", upload, name="upload"),
    path("api/sessions", sessions, name="sessions"),
    path("api/sessions/<str:sid>", session_detail, name="session_detail"),
    path("api/sessions/<str:sid>/trace", trace, name="trace"),
    path("api/session/<str:sid>/export", export_session, name="export_session"),
    path("api/session/import", import_session, name="import_session"),
    path("api/llm/config", llm_config, name="llm-config"),
    path("api/decompose", decompose, name="decompose"),
    path("api/decompose/<str:sid>/trace", decompose_trace, name="decompose-trace"),
]
