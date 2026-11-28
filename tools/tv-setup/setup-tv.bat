@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Rangs Hotel TV - setup
cd /d "%~dp0"
set PKG=com.rangs.hotellauncher

where adb >nul 2>nul
if errorlevel 1 (
  if exist "%~dp0adb.exe" ( set "PATH=%~dp0;%PATH%" ) else if exist "%~dp0..\adb.exe" ( set "PATH=%~dp0..;%PATH%" ) else (
    echo [X] adb.exe paoa jayni. Ei file-ta platform-tools folder-e rakhun, ba adb PATH-e din.
    pause & exit /b 1
  )
)

echo ============================================================
echo   Rangs Hotel TV - TV setup
echo   TV-te: Developer options ^> Wireless debugging chalu rakhun
echo ============================================================
echo.
set /p TV=TV-r IP:port likhun (jemon 192.168.1.107:41043): 
if "%TV%"=="" ( echo [X] Address dewa hoyni & pause & exit /b 1 )

adb connect %TV% >nul
adb -s %TV% get-state >nul 2>nul
if errorlevel 1 (
  echo [X] TV-te connect hoyni. Prothome "adb pair IP:port" diye pair korun, tarpor abar chalan.
  pause & exit /b 1
)
echo [OK] Connected: %TV%

set APK=
for %%f in (hotel*.apk) do set "APK=%%f"
if defined APK (
  echo [..] Install: !APK!
  adb -s %TV% install -r "!APK!"
  if errorlevel 1 (
    echo [i] Puraton test version onno key-e sign kora - ota muche notun-ta install korchi
    adb -s %TV% uninstall %PKG%
    adb -s %TV% install "!APK!" || ( echo [X] Install hoyni & pause & exit /b 1 )
  )
) else (
  echo [i] Kono hotel*.apk ei folder-e nei - install bad dilam ^(app age thekei thakle cholbe^)
)

echo [..] Permission dicchi
adb -s %TV% shell appops set %PKG% SYSTEM_ALERT_WINDOW allow
adb -s %TV% shell appops set %PKG% ACCESS_RESTRICTED_SETTINGS allow >nul 2>nul
adb -s %TV% shell pm grant %PKG% android.permission.WRITE_SECURE_SETTINGS
adb -s %TV% shell pm grant %PKG% android.permission.POST_NOTIFICATIONS >nul 2>nul

rem Find the TV's own launcher before we change anything
set HOMEPKG=
for /f "tokens=1 delims=/" %%a in ('adb -s %TV% shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME ^| findstr /v "priority"') do set "HOMEPKG=%%a"
echo [i] TV-r nijer Home app: %HOMEPKG%

set "SAVE=disabled-%TV::=_%.txt"
if exist "%SAVE%" del "%SAVE%"
if not "%HOMEPKG%"=="%PKG%" if not "%HOMEPKG%"=="android" if not "%HOMEPKG%"=="" (
  echo [..] TV-r nijer launcher bondho: %HOMEPKG%
  adb -s %TV% shell pm disable-user --user 0 %HOMEPKG% && echo %HOMEPKG%>>"%SAVE%"
)
rem Google TV: the setup/repair app takes over as Home when the launcher is off (black screen)
adb -s %TV% shell pm list packages com.google.android.tungsten.setupwraith | findstr setupwraith >nul
if not errorlevel 1 (
  echo [..] Google TV repair screen bondho: com.google.android.tungsten.setupwraith
  adb -s %TV% shell pm disable-user --user 0 com.google.android.tungsten.setupwraith && echo com.google.android.tungsten.setupwraith>>"%SAVE%"
)

echo [..] Hotel Launcher-ke Home app banachhi
adb -s %TV% shell cmd package set-home-activity %PKG%/.HomeAlias
adb -s %TV% shell am start -n %PKG%/.MainActivity >nul
timeout /t 3 >nul
adb -s %TV% shell settings get secure enabled_accessibility_services | findstr HomeGuardService >nul
if errorlevel 1 (
  adb -s %TV% shell settings put secure enabled_accessibility_services %PKG%/.HomeGuardService
  adb -s %TV% shell settings put secure accessibility_enabled 1
)

echo.
echo ---------------- Check ----------------
for /f "tokens=1 delims=/" %%a in ('adb -s %TV% shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME ^| findstr /v "priority"') do echo Home app        : %%a
for /f "delims=" %%a in ('adb -s %TV% shell appops get %PKG% SYSTEM_ALERT_WINDOW') do echo Auto-start      : %%a
for /f "delims=" %%a in ('adb -s %TV% shell settings get secure enabled_accessibility_services') do echo Home button     : %%a
if exist "%SAVE%" echo Bondho kora app : %SAVE% file-e save kora ^(restore-tv.bat eta use korbe^)
echo ---------------------------------------
echo.
set /p R=TV restart korbo? (y/n): 
if /i "%R%"=="y" adb -s %TV% reboot
echo Shesh. TV chalu hole sorasori hotel screen ashbe.
pause
