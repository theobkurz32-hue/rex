@echo off
cd /d "%~dp0"
set "REX_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "REX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist dist\index.html (
  echo Build ausente. Instale as dependencias e execute node scripts\run.mjs build
  pause
  exit /b 1
)
echo HOTEL REX - abrindo http://127.0.0.1:4173
"%REX_NODE%" scripts\serve.mjs --background
if errorlevel 1 goto end
start "" "http://127.0.0.1:4173/"
echo Aplicacao iniciada. Esta janela pode ser fechada.
:end
pause
