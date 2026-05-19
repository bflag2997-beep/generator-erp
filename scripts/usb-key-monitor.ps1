$ErrorActionPreference = "SilentlyContinue"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$keyFileName = "generator-erp-usb.key"
$serverScript = Join-Path $root "server.js"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$outLog = Join-Path $root "server.out.log"
$errLog = Join-Path $root "server.err.log"
$pidFile = Join-Path $root "server.pid"

function Find-KeyDrive {
  foreach ($drive in Get-PSDrive -PSProvider FileSystem) {
    $keyPath = Join-Path $drive.Root $keyFileName
    if (Test-Path $keyPath) {
      return $drive.Root
    }
  }
}

function Get-ServerProcess {
  if (Test-Path $pidFile) {
    $pidValue = Get-Content $pidFile -Raw
    if ($pidValue -match "^\s*\d+\s*$") {
      return Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
    }
  }
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like "*server.js*" -and $_.CommandLine -like "*$root*" } |
    Select-Object -First 1
}

function Start-ErpServer {
  $running = Get-ServerProcess
  if ($running) { return }
  $process = Start-Process -FilePath $nodeExe `
    -ArgumentList "server.js" `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru
  Set-Content -Path $pidFile -Value $process.Id -Encoding ASCII
}

while ($true) {
  $keyDrive = Find-KeyDrive
  if ($keyDrive) {
    Start-ErpServer
  }
  Start-Sleep -Seconds 10
}
