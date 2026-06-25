$ErrorActionPreference = "Stop"

$RepoUrl = $env:NIPUX_REPO_URL
if (-not $RepoUrl) { $RepoUrl = "https://github.com/Nipux/nipux-local-ai.git" }

$InstallDir = $env:NIPUX_APP_DIR
if (-not $InstallDir) { $InstallDir = Join-Path $HOME ".nipux-local-ai/app" }

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Bun..."
  powershell -c "irm bun.sh/install.ps1 | iex"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required. Install Git for Windows and re-run this script."
}

if (-not (Test-Path (Join-Path $InstallDir ".git"))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null
  git clone $RepoUrl $InstallDir
} else {
  git -C $InstallDir pull --ff-only
}

Set-Location $InstallDir
bun install
bun run install:local

Write-Host ""
Write-Host "Start dev mode:"
Write-Host "  cd $InstallDir; bun run dev"
Write-Host ""
Write-Host "Start production mode after llama.cpp is running:"
Write-Host "  cd $InstallDir; bun run start"
