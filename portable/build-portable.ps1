param([switch]$SkipInstall)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "[1/4] Building frontend..."
if (-not (Test-Path (Join-Path $Root "node_modules\.bin\vite.cmd"))) {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
}
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

$BuildPython = Join-Path $Root ".portable-venv\Scripts\python.exe"
if (-not (Test-Path $BuildPython)) {
    Write-Host "[2/4] Creating portable build environment..."
    python -m venv (Join-Path $Root ".portable-venv")
}
if (-not $SkipInstall) {
    Write-Host "[2/4] Installing packaging dependencies..."
    & $BuildPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }
    & $BuildPython -m pip install -r (Join-Path $PSScriptRoot "requirements-build.txt")
    if ($LASTEXITCODE -ne 0) { throw "Portable dependency installation failed" }
}

Write-Host "[3/4] Building Windows portable package..."
Remove-Item -Recurse -Force (Join-Path $Root "build\ManimAgent") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $Root "release\ManimAgent") -ErrorAction SilentlyContinue
& $BuildPython -m PyInstaller --noconfirm --clean --distpath (Join-Path $Root "release") (Join-Path $PSScriptRoot "ManimAgent.spec")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed" }

Copy-Item (Join-Path $PSScriptRoot "README.txt") (Join-Path $Root "release\ManimAgent\README.txt") -Force
Copy-Item (Join-Path $PSScriptRoot "Stop.cmd") (Join-Path $Root "release\ManimAgent\Stop.cmd") -Force

Write-Host "[4/4] Compressing package..."
$Zip = Join-Path $Root "release\ManimAgent-Windows-x64.zip"
Remove-Item $Zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $Root "release\ManimAgent\*") -DestinationPath $Zip -CompressionLevel Optimal
Write-Host "Done: $Zip"
