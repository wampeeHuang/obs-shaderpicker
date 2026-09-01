@echo off
setlocal EnableExtensions
title OBS 着色器选型器 一键安装
cd /d "%~dp0"
:: ================= 0. 静默模式 (install.bat /silent) =================
set "SILENT="
for %%A in (%*) do if /i "%%~A"=="/silent" set "SILENT=1"
:: 静默时 PAUSE_CMD=ver>nul。不能用 rem：rem 会吞掉同行的 & exit /b 1
if defined SILENT (set "PAUSE_CMD=ver>nul") else (set "PAUSE_CMD=pause")

:: ================= 1. 管理员权限 =================
set "FAIL="
set "ELEVATED="
net session >nul 2>&1
if %errorlevel% neq 0 (
  if defined SILENT (
    echo [ERROR] 需要管理员权限才能写入 OBS 目录, 请以管理员身份运行 install.bat /silent
    set "FAIL=1"
  ) else (
    echo 需要管理员权限才能写入 OBS 目录, 正在请求提权...
    echo 请在弹窗中点击"是"。
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    set "ELEVATED=1"
  )
)
if defined FAIL exit /b 1
if defined ELEVATED exit /b

:: ================= 2. 定位 OBS 安装目录 =================
echo   ============================================
echo        OBS 着色器选型器
echo        汉化包 + 可视化包 · 一键安装
echo        142 种着色器效果 · 实时预览切换
echo   ============================================
echo.
echo  正在检查安装环境...
echo.
set "OBS_DIR="
if exist "C:\Program Files\obs-studio\bin\64bit\obs64.exe" set "OBS_DIR=C:\Program Files\obs-studio"
if not defined OBS_DIR if exist "C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe" set "OBS_DIR=C:\Program Files (x86)\obs-studio"
if not defined OBS_DIR if exist "D:\Program Files\obs-studio\bin\64bit\obs64.exe" set "OBS_DIR=D:\Program Files\obs-studio"
if not defined OBS_DIR if exist "%LocalAppData%\Programs\obs-studio\bin\64bit\obs64.exe" set "OBS_DIR=%LocalAppData%\Programs\obs-studio"
if not defined OBS_DIR for /f "skip=2 tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\OBS Studio" /v InstallLocation 2^>nul') do set "OBS_DIR=%%B"
if not defined OBS_DIR for /f "skip=2 tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\OBS Studio" /v InstallLocation 2^>nul') do set "OBS_DIR=%%B"

if not defined OBS_DIR (
  echo.
  echo [未找到 OBS Studio]
  echo.
  echo   情况1: 这台电脑还没安装 OBS。
  echo   情况2: 装了但在非默认目录, 需手动指定。
  echo.
  echo   若是情况1, 请先到官网免费安装 OBS Studio:
  echo     https://obsproject.com  -^> 下载安装包, 下一步到底即可
  echo   装完后再重新运行本安装包。
  echo.
  echo   若是情况2, 请输入 OBS 安装目录的完整路径, 例如:
  echo     C:\Program Files\obs-studio
  echo.
if defined SILENT (
  echo [ERROR] 未找到 OBS Studio, 静默安装中止
  set "FAIL=1"
)
  if not defined FAIL (
    set /p OBS_DIR=输入 OBS 安装目录, 直接回车=中止:
    if not defined OBS_DIR (
      echo.
      echo 未输入路径, 安装中止。
      echo 提示: 本插件需要先安装 OBS Studio 才能使用。
      %PAUSE_CMD%
      set "FAIL=1"
    )
  )
)
if defined FAIL exit /b 1
if not exist "%OBS_DIR%\bin\64bit\obs64.exe" (
  echo.
  echo [错误] 目录 %OBS_DIR% 下找不到 bin\64bit\obs64.exe。
  echo   请确认这是 OBS Studio 的安装目录。
  echo   若还没装 OBS, 请先安装: https://obsproject.com
  echo.
  %PAUSE_CMD%
  exit /b 1
)
echo 检测到 OBS: %OBS_DIR%

:: ================= 3. 检查 OBS 是否在运行 =================
tasklist /fi "imagename eq obs64.exe" 2>nul | find /i "obs64.exe" >nul
if %errorlevel% neq 0 goto :obs_done
echo.
echo [提示] 检测到 OBS 正在运行。安装需要写入 OBS 文件。
echo   你现在可以手动关闭 OBS; 5 秒后若仍在运行将自动关闭。
echo   (OBS 场景/设置会自动保存, 不会丢失)
timeout /t 5 /nobreak >nul
taskkill /f /im obs64.exe >nul 2>&1
:wait_obs
timeout /t 1 /nobreak >nul
tasklist /fi "imagename eq obs64.exe" 2>nul | find /i "obs64.exe" >nul
if %errorlevel% equ 0 goto :wait_obs
echo   OBS 已关闭, 继续安装。
:obs_done

:: ================= 4. 检查已装情况 =================
if exist "%OBS_DIR%\obs-plugins\64bit\obs-shaderfilter.dll" (
  echo.
  echo [检测] 已装过 obs-shaderfilter 插件, 将覆盖为汉化版。
  echo   已应用的着色器保存在 OBS 场景文件中, 覆盖不会丢失。
) else (
  echo.
  echo [检测] 未发现旧插件, 将全新安装汉化版插件。
)

if not exist "%OBS_DIR%\obs-plugins\64bit\obs-websocket.dll" (
  echo.
  echo [警告] 未检测到 obs-websocket.dll。
  echo   选型器面板需要 OBS 28 及以上自带的 WebSocket 服务。
  echo   若你的 OBS 较旧, 面板将无法连接, 建议先升级 OBS 再安装。
  echo.
  echo 按任意键继续安装, 或直接关闭本窗口取消。
  %PAUSE_CMD% >nul
)

:: ================= 5. 拷贝插件 =================
echo.
echo [1/4] 拷贝 obs-shaderfilter 插件...
if not exist "%OBS_DIR%\obs-plugins\64bit" mkdir "%OBS_DIR%\obs-plugins\64bit"
copy /y "%~dp0plugin\obs-shaderfilter.dll" "%OBS_DIR%\obs-plugins\64bit\" >nul
if %errorlevel% neq 0 ( echo   [错误] 拷贝 dll 失败 & %PAUSE_CMD% & exit /b 1 )
echo   DLL OK

if not exist "%OBS_DIR%\data\obs-plugins\obs-shaderfilter" mkdir "%OBS_DIR%\data\obs-plugins\obs-shaderfilter"
xcopy "%~dp0plugin\data\obs-shaderfilter" "%OBS_DIR%\data\obs-plugins\obs-shaderfilter" /e /i /y /q
if %errorlevel% geq 4 ( echo   [错误] 拷贝数据文件失败 & %PAUSE_CMD% & exit /b 1 )
echo   数据 OK (examples / textures / locale / internal)

:: ================= 6. 拷贝面板 =================
echo.
echo [2/4] 拷贝选型器面板...
if not exist "%OBS_DIR%\data\obs-shaderpicker\panel" mkdir "%OBS_DIR%\data\obs-shaderpicker\panel"
xcopy "%~dp0panel" "%OBS_DIR%\data\obs-shaderpicker\panel" /e /i /y /q
if %errorlevel% geq 4 ( echo   [错误] 拷贝面板失败 & %PAUSE_CMD% & exit /b 1 )
echo   面板 OK

:: ================= 7. 配置 websocket + config.js + dock =================
echo.
echo [3/4] 配置 obs-websocket 与停靠面板...
set "SP_OBS_DIR=%OBS_DIR:\=/%"
set "SP_APPDATA=%APPDATA%\obs-studio"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0provision.ps1"
if %errorlevel% neq 0 ( echo   [错误] 配置失败 & %PAUSE_CMD% & exit /b 1 )
echo   配置 OK

:: ================= 8. 完成 =================
echo.
echo [4/4] 安装完成!
echo.
echo   OBS 已写入:
echo     - 插件 obs-shaderfilter (汉化版)
echo     - 选型器面板 (data\obs-shaderpicker\panel)
echo     - obs-websocket 服务 (端口 4455, 密码已自动写入)
echo     - 停靠窗口 "OBS 着色器选型器"
echo.
echo   请重新打开 OBS:
echo     菜单"停靠窗口(Docks)" -^> 勾选"OBS 着色器选型器"
echo   若首次使用, 需在 工具-^>WebSocket 服务器设置 确认已启用(安装已自动启用)。
echo.
echo.
echo   安装完成! 请打开 OBS 开始使用。
echo.
echo   按任意键退出本窗口...
  %PAUSE_CMD% >nul
exit /b 0
