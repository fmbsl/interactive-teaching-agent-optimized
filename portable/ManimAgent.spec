# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

root = Path.cwd()
datas = [
    (str(root / "dist"), "dist"),
    (str(root / "tools" / "demo" / "_mw_exs"), "tools/demo/_mw_exs"),
]
binaries = []
hiddenimports = [
    "backend.settings", "backend.urls", "backend.wsgi",
    "middleware", "agent", "api.apps", "api.views",
    "skill.main_agent", "skill.outline_agent", "skill.step_agent",
]

for package in (
    "django", "corsheaders", "langgraph", "langgraph_prebuilt",
    "langchain_core", "langchain_openai", "openai", "pdfplumber",
):
    package_datas, package_bins, package_hidden = collect_all(package)
    datas += package_datas
    binaries += package_bins
    hiddenimports += package_hidden

hiddenimports += collect_submodules("skill")

a = Analysis(
    [str(root / "portable" / "launcher.py")],
    pathex=[str(root / "backend"), str(root)],
    binaries=binaries, datas=datas, hiddenimports=hiddenimports,
    hookspath=[], hooksconfig={}, runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy.tests"],
    noarchive=False, optimize=1,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [], exclude_binaries=True, name="ManimAgent",
    debug=False, bootloader_ignore_signals=False, strip=False, upx=True,
    console=True, disable_windowed_traceback=False, argv_emulation=False,
    target_arch=None, codesign_identity=None, entitlements_file=None,
)
coll = COLLECT(
    exe, a.binaries, a.datas, strip=False, upx=True, upx_exclude=[],
    name="ManimAgent",
)
