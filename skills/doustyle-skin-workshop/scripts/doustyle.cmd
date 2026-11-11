@echo off
setlocal DisableDelayedExpansion
set "SKILL_ROOT=%~dp0.."
set "RESOURCE_DIR=%DOUSTYLE_RESOURCE_DIR%"
if defined RESOURCE_DIR if exist "%RESOURCE_DIR%\runtime\node.exe" if exist "%RESOURCE_DIR%\theme\skin-cli.mjs" goto bundled
if exist "%SKILL_ROOT%\local-resources.txt" set /p "RESOURCE_DIR="<"%SKILL_ROOT%\local-resources.txt"
if defined RESOURCE_DIR if exist "%RESOURCE_DIR%\runtime\node.exe" if exist "%RESOURCE_DIR%\theme\skin-cli.mjs" goto bundled
if exist "%SKILL_ROOT%\..\..\skin-cli.mjs" set "SOURCE_DIR=%SKILL_ROOT%\..\.."
if not defined SOURCE_DIR if exist "%SKILL_ROOT%\local-source.txt" set /p "SOURCE_DIR="<"%SKILL_ROOT%\local-source.txt"
if defined SOURCE_DIR if exist "%SOURCE_DIR%\skin-cli.mjs" goto source
echo Please install and start DouStyle with skin support first. 1>&2
exit /b 1
:bundled
"%RESOURCE_DIR%\runtime\node.exe" "%RESOURCE_DIR%\theme\skin-cli.mjs" %*
exit /b %errorlevel%
:source
node "%SOURCE_DIR%\skin-cli.mjs" %*
exit /b %errorlevel%
