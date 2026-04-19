@echo off
cd /d "C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\frontend"
echo ===== RUNNING NPM LINT =====
call npm run lint
set LINT_CODE=%ERRORLEVEL%
echo.
echo LINT EXIT CODE: %LINT_CODE%
echo.
echo ===== RUNNING NPM BUILD =====
call npm run build
set BUILD_CODE=%ERRORLEVEL%
echo.
echo BUILD EXIT CODE: %BUILD_CODE%
echo.
echo ===== SUMMARY =====
echo Lint Status: %LINT_CODE%
echo Build Status: %BUILD_CODE%
