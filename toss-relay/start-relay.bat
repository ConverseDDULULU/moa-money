@echo off
chcp 65001 >nul
title 모아 가계부 - 토스증권 중계 프로그램
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js가 설치되어 있지 않아요.
  echo   https://nodejs.org 에서 LTS 버전을 설치한 뒤, 이 파일을 다시 더블클릭해 주세요.
  echo.
  pause
  exit /b 1
)
node "%~dp0relay.mjs"
echo.
echo   중계 프로그램이 멈췄어요. 위의 안내를 확인한 뒤 이 창을 닫아 주세요.
pause
