@echo off
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"
set NPM_CONFIG_CACHE=%SCRIPT_DIR%.npm-cache
npm start
