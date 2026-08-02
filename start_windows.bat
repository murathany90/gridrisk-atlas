@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Wildfire Grid Risk Monitor v3.6.0
cls
echo ============================================================
echo  Wildfire Grid Risk Monitor v3.6.0
echo ============================================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi.
  echo Node.js 18 veya daha yeni bir surum kurun: https://nodejs.org/
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo Node: %%v
echo.
echo Bu surum eski localhost:8765 oturumunu KULLANMAZ.
echo 8890 doluysa otomatik olarak bir sonraki bos port secilir.
echo Tarayici, yeni sunucu basariyla acildiktan SONRA acilir.
echo.
if "%FIRMS_MAP_KEY%"=="" set /p "FIRMS_MAP_KEY=NASA FIRMS MAP_KEY (yoksa Enter): "
set "PORT=8890"
set "AUTO_OPEN=1"
echo.
echo Sunucu baslatiliyor...
echo Pencereyi kapatmak icin Ctrl+C kullanabilirsiniz.
echo.
node server.mjs
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [HATA] Sunucu %RC% koduyla kapandi.
  pause
)
endlocal
