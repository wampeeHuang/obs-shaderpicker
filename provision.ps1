# 安装器第二步: 配置 obs-websocket + 面板 config.js + 注入 dock。
# 由 install.bat 调用, 通过环境变量传参, 规避 bat→ps1 中文/引号转义问题。
# 用法: powershell -ExecutionPolicy Bypass -File provision.ps1
#   需要 SP_OBS_DIR (OBS 安装根目录, 正斜杠) 与 SP_APPDATA (OBS 配置目录) 两个环境变量。

$ErrorActionPreference = 'Stop'
$obsDir = $env:SP_OBS_DIR
$appData = $env:SP_APPDATA
if (-not $obsDir -or -not $appData) {
  Write-Output 'FATAL: SP_OBS_DIR / SP_APPDATA 未设置'
  exit 1
}

$panelDir   = "$obsDir/data/obs-shaderpicker/panel"
$shaderDir  = "$obsDir/data/obs-plugins/obs-shaderfilter/examples"
$dllTarget  = "$obsDir/obs-plugins/64bit"
$wsConfig   = "$appData/plugin_config/obs-websocket/config.json"
$userIni    = "$appData/user.ini"

# ---------- 1. obs-websocket: 启用服务, 复用已有密码或生成新密码 ----------
$password = ''
if (Test-Path $wsConfig) {
  $ws = Get-Content $wsConfig -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($ws.server_enabled -and $ws.server_password) {
    $password = $ws.server_password
    Write-Output ("WS: 复用已有密码, port=" + $ws.server_port)
  }
}
if (-not $password) {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  $rand = New-Object System.Random
  $password = -join (1..16 | ForEach-Object { $chars[$rand.Next(0, $chars.Length)] })
  $wsObj = [pscustomobject]@{
    alerts_enabled = $false
    auth_required = $true
    first_load = $false
    server_enabled = $true
    server_password = $password
    server_port = 4455
  }
  $wsDir = Split-Path $wsConfig -Parent
  if (-not (Test-Path $wsDir)) { New-Item -ItemType Directory -Path $wsDir -Force | Out-Null }
  [IO.File]::WriteAllText($wsConfig, ($wsObj | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
  Write-Output ('WS: 已启用 + 生成新密码, port=4455')
}
if (-not $password) { Write-Output 'FATAL: 无法确定 obs-websocket 密码'; exit 1 }

# ---------- 2. 面板 config.js: 写入正确 shaderDir + 密码 ----------
$cfg = @"
// 由安装器生成。obsUrl/端口/密码随 obs-websocket 自动配置; 也可在面板右上角 ⚙ 里改。
window.__SP_CONFIG__ = {
  obsUrl: 'ws://127.0.0.1:4455',
  password: '$password',
  sourceName: '摄像头',
  filterName: '用户自定义着色器',
  shaderDir: '$($shaderDir -replace '\\','/')/',
};
"@
$panelDirOut = $panelDir -replace '/','\'
if (-not (Test-Path $panelDirOut)) { New-Item -ItemType Directory -Path $panelDirOut -Force | Out-Null }
[IO.File]::WriteAllText("$panelDirOut\config.js", $cfg, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("CONFIG: 已写入 config.js, shaderDir=" + ($shaderDir -replace '\\','/') + "/")

# ---------- 3. 注入 dock 到 user.ini ----------
$dockUrl = 'file:///' + ($obsDir -replace '\\','/') + '/data/obs-shaderpicker/panel/index.html'
$Title = 'OBS 着色器选型器'
$OldTitle = 'obs-shaderfilter插件'

if (-not (Test-Path $userIni)) {
  $txt = ''
  $list = @()
  $injectLine = 'ExtraBrowserDocks='
} else {
  $txt = [IO.File]::ReadAllText($userIni, [Text.Encoding]::UTF8)
  $m = [regex]::Match($txt, '(?m)^ExtraBrowserDocks=(.*)$')
  if (-not $m.Success) { $list = @(); $injectLine = 'ExtraBrowserDocks=' } else {
    $list = $m.Groups[1].Value | ConvertFrom-Json
    if ($null -eq $list) { $list = @() }
    $injectLine = $null
  }
}
$kept = @($list | Where-Object { $_.title -ne $OldTitle -and $_.url -notmatch 'localhost:3311' })
$existing = $kept | Where-Object { $_.title -eq $Title }
if (-not $existing) {
  $uuid = $null
  $old = $list | Where-Object { $_.title -eq $OldTitle } | Select-Object -First 1
  if ($old -and $old.uuid) { $uuid = $old.uuid }
  if (-not $uuid) { $uuid = [guid]::NewGuid().ToString('N') }
  $kept += [pscustomobject]@{ title = $Title; url = $dockUrl; uuid = $uuid }
} else {
  $kept = @($kept | ForEach-Object {
    if ($_.title -eq $Title) { [pscustomobject]@{ title = $Title; url = $dockUrl; uuid = $_.uuid } } else { $_ }
  })
}
$json = '[' + (($kept | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 5 }) -join ',') + ']'
if ($injectLine) {
  $pos = $txt.IndexOf('[BasicWindow]')
  if ($pos -ge 0) {
    $segEnd = $txt.IndexOf('[', $pos + 1)
    if ($segEnd -lt 0) { $segEnd = $txt.Length }
    $txt = $txt.Substring(0, $segEnd) + "`r`nExtraBrowserDocks=$json`r`n" + $txt.Substring($segEnd)
  } else {
    $txt = $txt.TrimEnd() + "`r`n`r`n[BasicWindow]`r`nExtraBrowserDocks=$json`r`n"
  }
} else {
  $txt = [regex]::Replace($txt, '(?m)^ExtraBrowserDocks=.*$', "ExtraBrowserDocks=$json")
}
[IO.File]::WriteAllText($userIni, $txt, (New-Object System.Text.UTF8Encoding($true)))
Write-Output ("DOCK: " + $json)

Write-Output 'PROVISION_OK'
