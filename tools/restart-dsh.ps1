<#
重启 DSH 桌面端（托盘进程），可选在重启后回到会话。

为什么单独写脚本而不是手工点：手工点没法计时、没法验证"起来没有"。

用法：
  # 只演练：列出将要做的事，不杀进程
  .\restart-dsh.ps1 -DryRun

  # 真的重启（会杀掉当前会话的宿主进程）
  .\restart-dsh.ps1 -WaitSeconds 30

  # 用替身进程测试脚本本身的机制（不碰 DSH）
  .\restart-dsh.ps1 -ProcessName 'ping' -WaitSeconds 2 -TestMode
#>
param(
  [string]$ProcessName = 'DeepSeek Harness',
  [int]$WaitSeconds = 30,
  [switch]$DryRun,
  [switch]$TestMode
)

$ErrorActionPreference = 'Stop'

function Find-Targets([string]$name) {
  Get-Process -Name $name -ErrorAction SilentlyContinue
}

function Wait-Port([int]$port, [int]$timeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $client = [System.Net.Sockets.TcpClient]::new()
      $client.Connect('127.0.0.1', $port)
      $client.Close()
      return $true
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return $false
}

Write-Host "目标进程名: $ProcessName"
$targets = Find-Targets $ProcessName
if (-not $targets) {
  Write-Host "没有找到进程 '$ProcessName'。"
  if (-not $TestMode) { exit 1 }
  Write-Host "（测试模式：先起一个替身进程）"
  Start-Process -FilePath 'ping.exe' -ArgumentList '-n','60','127.0.0.1' -WindowStyle Hidden
  Start-Sleep -Seconds 1
  $targets = Find-Targets $ProcessName
  if (-not $targets) { Write-Host '替身进程也没起来'; exit 1 }
}

$targets | Select-Object Id, ProcessName, StartTime | Format-Table -AutoSize | Out-String | Write-Host

if ($DryRun) {
  Write-Host "[DryRun] 将结束上面 $($targets.Count) 个进程，等 $WaitSeconds 秒，再启动一次。"
  exit 0
}

# 记录启动路径：DSH 的 exe 路径从进程里取；替身进程取 ping 的路径
$exePath = $targets[0].Path
Write-Host "可执行文件: $exePath"

# 2026-11-14 实测教训：命令行必须在**杀进程之前**取，否则进程已经没了，CIM 查不到。
$origExe = $exePath
$origArgs = @()
$origCwd = Split-Path -Parent $exePath
try {
  $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $($targets[0].Id)"
  if ($cim -and $cim.CommandLine) {
    $cmdLine = $cim.CommandLine
    if ($cmdLine.StartsWith('"')) {
      $close = $cmdLine.IndexOf('"', 1)
      $exeFromCmd = $cmdLine.Substring(1, $close - 1)
      $rest = $cmdLine.Substring($close + 1).Trim()
    } else {
      $space = $cmdLine.IndexOf(' ')
      $exeFromCmd = if ($space -gt 0) { $cmdLine.Substring(0, $space) } else { $cmdLine }
      $rest = if ($space -gt 0) { $cmdLine.Substring($space + 1).Trim() } else { '' }
    }
    if ($exeFromCmd) { $origExe = $exeFromCmd; $origCwd = Split-Path -Parent $exeFromCmd }
    if ($rest) { $origArgs = @($rest) }
  }
} catch {
  Write-Host "取原始命令行失败，退回只给路径: $($_.Exception.Message)"
}
Write-Host "重启时使用: $origExe $($origArgs -join ' ')  （cwd: $origCwd）"

foreach ($p in $targets) {
  try {
    Write-Host "结束 $($p.Id) ..."
    $p.Kill()
  } catch {
    Write-Host "结束 $($p.Id) 失败: $($_.Exception.Message)"
  }
}

$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
  if (-not (Find-Targets $ProcessName)) { break }
  Start-Sleep -Milliseconds 300
}
Write-Host "已停止。等待 $WaitSeconds 秒后重启 ..."
Start-Sleep -Seconds $WaitSeconds

# 2026-11-14 实测：命令行在杀进程之前已经取好（$origExe / $origArgs / $origCwd）。
Write-Host "启动: $origExe"
if ($origArgs.Count -gt 0) { Write-Host "参数: $($origArgs -join ' ')" }
Write-Host "工作目录: $origCwd"
Start-Process -FilePath $origExe -ArgumentList $origArgs -WorkingDirectory $origCwd
Start-Sleep -Seconds 3

$back = Find-Targets $ProcessName
if ($back) {
  Write-Host "已重启：$($back[0].Id) $($back[0].ProcessName)"
} else {
  Write-Host '重启失败：进程没起来'
  exit 1
}

if (-not $TestMode) {
  Write-Host '等待 127.0.0.1:8790（DSH 端点）...'
  if (Wait-Port 8790 90) { Write-Host '端点已就绪' } else { Write-Host '端点 90 秒内没起来' }
}
