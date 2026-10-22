[CmdletBinding()]
param(
    [ValidateSet('smoke', 'core-install')]
    [string]$Mode = 'smoke',
    [switch]$Headed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$SecretsFile = Join-Path $RepositoryRoot '.secrets\router-e2e.env'
$ExampleFile = Join-Path $RepositoryRoot '.secrets\router-e2e.env.example'

function Import-RouterE2eSecrets {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Не найден локальный файл секретов: $Path. Скопируйте $ExampleFile в router-e2e.env и заполните значения."
    }

    foreach ($rawLine in Get-Content -LiteralPath $Path -Encoding utf8) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith('#')) {
            continue
        }
        $parts = $line.Split('=', 2)
        if ($parts.Count -ne 2 -or -not $parts[0].Trim()) {
            throw "Некорректная строка в ${Path}: $rawLine"
        }
        Set-Item -Path "Env:$($parts[0].Trim())" -Value $parts[1].Trim()
    }
}

function Require-Environment {
    param([string[]]$Names)

    foreach ($name in $Names) {
        if (-not (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue).Value) {
            throw "В $SecretsFile отсутствует обязательная переменная $name."
        }
    }
}

function Invoke-External {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Команда завершилась с кодом ${LASTEXITCODE}: $FilePath"
    }
}

Import-RouterE2eSecrets -Path $SecretsFile
Require-Environment -Names @(
    'XKEEN_ROUTER_E2E_BASE_URL',
    'XKEEN_ROUTER_E2E_USERNAME',
    'XKEEN_ROUTER_E2E_PASSWORD',
    'XKEEN_ROUTER_SSH_HOST',
    'XKEEN_ROUTER_SSH_PORT',
    'XKEEN_ROUTER_SSH_PASSWORD'
)

$baseUrl = [uri]$env:XKEEN_ROUTER_E2E_BASE_URL
if ($baseUrl.Scheme -notin @('http', 'https') -or -not $baseUrl.Host) {
    throw 'XKEEN_ROUTER_E2E_BASE_URL должен быть полным HTTP(S) URL панели.'
}

$env:E2E_BASE_URL = $baseUrl.AbsoluteUri.TrimEnd('/')
$env:E2E_USERNAME = $env:XKEEN_ROUTER_E2E_USERNAME
$env:E2E_PASSWORD = $env:XKEEN_ROUTER_E2E_PASSWORD
$env:E2E_ROUTER_SMOKE = '1'
$env:XKEEN_STAGE88_PANEL_USER = $env:XKEEN_ROUTER_E2E_USERNAME
$env:XKEEN_STAGE88_PANEL_PASSWORD = $env:XKEEN_ROUTER_E2E_PASSWORD
$env:XKEEN_STAGE88_SSH_HOST = $env:XKEEN_ROUTER_SSH_HOST
$env:XKEEN_STAGE88_SSH_PASSWORD = $env:XKEEN_ROUTER_SSH_PASSWORD

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportDir = Join-Path $RepositoryRoot ".tmp\router-e2e\$runId"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

$python = Join-Path $RepositoryRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    $python = 'python'
}

Write-Host "Read-only preflight: $($baseUrl.Scheme)://$($baseUrl.Authority)/"
Invoke-External -FilePath $python -Arguments @(
    'scripts/stage8_8_router_smoke.py',
    '--http-url', $env:E2E_BASE_URL,
    '--panel-user', $env:E2E_USERNAME,
    '--ssh-host', $env:XKEEN_ROUTER_SSH_HOST,
    '--ssh-port', $env:XKEEN_ROUTER_SSH_PORT,
    '--output', (Join-Path $reportDir 'router-preflight.json')
)

$spec = 'e2e/router_panel_smoke.spec.mjs'
if ($Mode -eq 'core-install') {
    Require-Environment -Names @('XKEEN_ROUTER_E2E_STAND_NAME')
    if ($env:XKEEN_ROUTER_E2E_ALLOW_DESTRUCTIVE -ne '1') {
        throw 'Переустановка ядра заблокирована. Для выделенного одноразового стенда установите XKEEN_ROUTER_E2E_ALLOW_DESTRUCTIVE=1 в локальном файле секретов.'
    }
    $env:E2E_ROUTER_DESTRUCTIVE = '1'
    $spec = 'e2e/router_core_install.spec.mjs'
    Write-Host "Destructive scenario allowed for stand: $env:XKEEN_ROUTER_E2E_STAND_NAME"
}

$playwrightArgs = @('playwright', 'test', $spec, '--workers=1')
if ($Headed) {
    $playwrightArgs += '--headed'
}

Write-Host "Browser scenario: $Mode"
Invoke-External -FilePath 'npx' -Arguments $playwrightArgs
Write-Host "Completed. Evidence: $reportDir"
