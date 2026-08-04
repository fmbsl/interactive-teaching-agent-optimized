"""pytest 配置:先配好 Django,让 api.* / skill.* 模块可导入(不碰真实会话数据)。"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
import django
django.setup()
