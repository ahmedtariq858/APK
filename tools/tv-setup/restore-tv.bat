@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Rangs Hotel TV - restore
cd /d "%~dp0"
set PKG=com.rangs.hotellauncher
where adb >nul 2>nul || if exist "%~dp0adb.exe" set "PATH=%~dp0;%PATH%"
where adb >nul 2>nul || if exist "%~dp0..\adb.exe" set "PATH=%~dp0..;%PATH%"

echo ============================================================
echo   Rangs Hotel TV - TV-ke shadharon obosthay ferano
echo ============================================================
set /p TV=TV-r IP:port likhun (jemon 192.168.1.107:41043): 
adb connect %TV% >nul
adb -s %TV% get-state >nul 2>nul || ( echo [X] TV-te connect hoyni & pause & exit /b 1 )

set FOUND=0
for %%f in (disabled-*.txt) do (
  for /f "usebackq delims=" %%p in ("%%f") do (
    echo [..] Chalu korchi: %%p
    adb -s %TV% shell pm enable %%p
    set FOUND=1
  )
)
rem Always bring back the common Google TV / Android TV home apps
for %%p in (com.google.android.apps.tv.launcherx com.google.android.tungsten.setupwraith com.google.android.tvlauncher com.google.android.leanbacklauncher) do (
  adb -s %TV% shell pm enable %%p >nul 2>nul
)

set /p U=Hotel Launcher app-o muche felbo? (y/n): 
if /i "%U%"=="y" (
  adb -s %TV% shell settings delete secure enabled_accessibility_services
  adb -s %TV% uninstall %PKG%
)
adb -s %TV% reboot
echo Shesh. TV restart hole shadharon Google TV / Android TV home ashbe.
pause
