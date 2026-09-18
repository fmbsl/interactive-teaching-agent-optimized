@echo off
taskkill /F /IM ManimAgent.exe >nul 2>nul
echo Manim Agent has stopped.
timeout /t 2 >nul
