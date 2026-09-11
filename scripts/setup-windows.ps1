<#
.SYNOPSIS
  Windows prerequisite check for the Kerbside demo.

.DESCRIPTION
  Checks for Node 20+, the AWS CLI and git, reports what is missing, and
  prints the exact winget command to install each one. Nothing is installed
  unless you pass -Install.

  This runs BEFORE `npm run setup`, because that one needs Node to already
  exist. Once this passes, switch to `npm run setup`, which does the deeper
  checks (credentials actually resolving, bucket name changed) on every
  platform.

.PARAMETER Install
  Install anything missing via winget instead of only reporting it. You will
  still be prompted by winget itself for each package.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Install
#>

[CmdletBinding()]
param(
    [switch]$Install
)

$ErrorActionPreference = 'Stop'
$script:Ready = $true

function Write-Ok    ($m) { Write-Host "  [ok] $m" -ForegroundColor Green }
function Write-Bad   ($m) { Write-Host "  [!!] $m" -ForegroundColor Red; $script:Ready = $false }
function Write-Note  ($m) { Write-Host "  [--] $m" -ForegroundColor DarkGray }
function Write-Cmd   ($m) { Write-Host "       $m" -ForegroundColor Cyan }

Write-Host ""
Write-Host "Kerbside prerequisites (Windows)" -ForegroundColor White
Write-Host ""

# --- PowerShell itself -------------------------------------------------
$psMajor = $PSVersionTable.PSVersion.Major
if ($psMajor -ge 5) {
    Write-Ok "PowerShell $($PSVersionTable.PSVersion)"
} else {
    Write-Bad "PowerShell $($PSVersionTable.PSVersion) is older than 5.1. Update Windows Management Framework."
}

# --- winget ------------------------------------------------------------
$hasWinget = $null -ne (Get-Command winget -ErrorAction SilentlyContinue)
if ($hasWinget) {
    Write-Ok "winget available"
} else {
    Write-Note "winget not found. It ships with App Installer on Windows 10 1809+ and Windows 11."
    Write-Note "Without it, install the tools below by hand from their download pages."
}

function Install-Or-Advise {
    param(
        [string]$Label,
        [string]$WingetId,
        [string]$ManualUrl
    )

    if ($Install -and $hasWinget) {
        Write-Host "       installing $Label ..." -ForegroundColor Yellow
        # --exact avoids winget picking a similarly named package.
        winget install --exact --id $WingetId --accept-source-agreements
        Write-Note "Open a NEW terminal afterwards so PATH changes apply."
    } elseif ($hasWinget) {
        Write-Cmd "winget install --exact --id $WingetId"
        Write-Note "Then open a NEW terminal so PATH changes apply."
    } else {
        Write-Cmd $ManualUrl
    }
}

# --- Node --------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodeVersion = (& node -v).TrimStart('v')
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -ge 20) {
        Write-Ok "Node v$nodeVersion"
    } else {
        Write-Bad "Node v$nodeVersion found, but this repo needs Node 20 or later."
        Install-Or-Advise -Label "Node LTS" -WingetId "OpenJS.NodeJS.LTS" -ManualUrl "https://nodejs.org/en/download"
    }
} else {
    Write-Bad "Node not found on PATH."
    Install-Or-Advise -Label "Node LTS" -WingetId "OpenJS.NodeJS.LTS" -ManualUrl "https://nodejs.org/en/download"
}

# --- AWS CLI -----------------------------------------------------------
$aws = Get-Command aws -ErrorAction SilentlyContinue
if ($aws) {
    $awsVersion = (& aws --version 2>&1) -join ' '
    Write-Ok "AWS CLI ($awsVersion)"
} else {
    Write-Bad "AWS CLI not found on PATH."
    Install-Or-Advise -Label "AWS CLI v2" -WingetId "Amazon.AWSCLI" -ManualUrl "https://awscli.amazonaws.com/AWSCLIV2.msi"
}

# --- git (only needed to clone) ----------------------------------------
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Ok "git available"
} else {
    Write-Note "git not found. Only needed if you are cloning this repo rather than copying it."
    if ($hasWinget) { Write-Cmd "winget install --exact --id Git.Git" }
}

# --- credentials -------------------------------------------------------
Write-Host ""
if ($aws) {
    # A failing native exe sets $LASTEXITCODE rather than throwing, so a
    # try/catch alone would silently report success here.
    $identityJson = & aws sts get-caller-identity --output json 2>$null
    $identity = $null
    if ($LASTEXITCODE -eq 0 -and $identityJson) {
        try { $identity = $identityJson | ConvertFrom-Json } catch { $identity = $null }
    }

    if ($identity) {
        Write-Ok "AWS credentials resolve - account $($identity.Account)"
        Write-Note "as $($identity.Arn)"
    } else {
        Write-Bad "AWS CLI is installed but no credentials resolve yet."
        Write-Note "Any source works: profile, assume-role, SSO, env vars. This must succeed:"
        Write-Cmd "aws sts get-caller-identity"
        Write-Note "For SSO:"
        Write-Cmd "aws configure sso"
        Write-Cmd "aws sso login --profile kerbside-demo"
        Write-Note "Then select it for this session:"
        Write-Cmd '$env:AWS_PROFILE = "kerbside-demo"'
    }
} else {
    Write-Note "Skipping the credential check until the AWS CLI is installed."
}

# --- next steps --------------------------------------------------------
Write-Host ""
if ($script:Ready) {
    Write-Host "Prerequisites look good." -ForegroundColor Green
    Write-Host ""
    Write-Host "Set your demo variables for this session (PowerShell syntax):"
    Write-Cmd '$env:AWS_PROFILE = "kerbside-demo"'
    Write-Cmd '$env:AWS_REGION = "eu-west-2"'
    Write-Cmd '$env:KERBSIDE_BUCKET = "kerbside-demo-assets-<something-unique>"'
    Write-Host ""
    Write-Host "Then run the cross-platform check, which goes deeper:"
    Write-Cmd "npm run setup"
    exit 0
} else {
    Write-Host "Fix the items marked [!!] above, open a new terminal, then re-run this script." -ForegroundColor Yellow
    Write-Host "Re-run with -Install to let winget install the missing tools for you."
    exit 1
}
