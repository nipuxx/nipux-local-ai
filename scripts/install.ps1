$ErrorActionPreference = "Stop"

$RepoUrl = $env:NIPUX_REPO_URL
if (-not $RepoUrl) { $RepoUrl = "https://github.com/nipuxx/nipux-local-ai.git" }

$InstallDir = $env:NIPUX_APP_DIR
if (-not $InstallDir) { $InstallDir = Join-Path $HOME ".nipux-local-ai/app" }

$InstallBrowsers = $env:NIPUX_INSTALL_BROWSERS
if (-not $InstallBrowsers) { $InstallBrowsers = "1" }

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE"
  }
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Bun..."
  powershell -c "irm bun.sh/install.ps1 | iex"
  $env:Path = "$HOME\.bun\bin;$env:Path"
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  throw "Bun is still not on PATH. Open a new PowerShell window or add $HOME\.bun\bin to PATH."
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required. Run: winget install Git.Git"
}

if (-not (Test-Path (Join-Path $InstallDir ".git"))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null
  Invoke-Checked git clone $RepoUrl $InstallDir
} else {
  Invoke-Checked git -C $InstallDir pull --ff-only
}

Set-Location $InstallDir
Invoke-Checked bun install --frozen-lockfile
Invoke-Checked bun run setup

if ($InstallBrowsers -ne "0") {
  Write-Host ""
  Write-Host "Installing Playwright Chromium for browser agents..."
  & bun run browsers:install
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Chromium install failed. Browser agents can be repaired later with: bun run browsers:install"
  }
}

Write-Host ""
Write-Host "Start dev mode:"
Write-Host "  cd $InstallDir; bun run dev"
Write-Host ""
Write-Host "Start production mode after llama.cpp is running:"
Write-Host "  cd $InstallDir; bun run start"
Write-Host ""
Write-Host "Health check:"
Write-Host "  cd $InstallDir; bun run preflight"
