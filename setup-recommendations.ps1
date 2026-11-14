[CmdletBinding()]
param([string]$DataDirectory=$env:GROCERY_DATA_DIR)

$ErrorActionPreference = 'Stop'
$projectDirectory = [System.IO.Path]::GetFullPath($PSScriptRoot)
if (!$DataDirectory) { $DataDirectory = Join-Path $projectDirectory '.data' }
$recommendationDirectory = Join-Path $DataDirectory 'recommendations'
$environmentDirectory = Join-Path $recommendationDirectory 'venv'
$environmentPython = Join-Path $environmentDirectory 'Scripts\python.exe'
$requirementsPath = Join-Path $projectDirectory 'recommendation-requirements.txt'

function Test-RecommendationPython {
    param([string]$Executable, [string[]]$LaunchArguments = @())
    try {
        $versionJson = & $Executable @LaunchArguments -c 'import json,sys; print(json.dumps(list(sys.version_info[:2])))' 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        $version = $versionJson | ConvertFrom-Json
        return ($version[0] -eq 3 -and $version[1] -ge 10 -and $version[1] -le 13)
    } catch { return $false }
}

if (-not (Test-Path -LiteralPath $requirementsPath -PathType Leaf)) {
    throw 'The recommendation requirements file is missing. Restore the application files and try again.'
}

$selectedPython = $null
$selectedArguments = @()
if ($env:GROCERY_PYTHON) {
    if (-not (Test-RecommendationPython -Executable $env:GROCERY_PYTHON)) {
        throw 'GROCERY_PYTHON must point to a working Python 3.10 through 3.13 executable. Python 3.12 is recommended.'
    }
    $selectedPython = $env:GROCERY_PYTHON
} else {
    foreach ($candidate in @('python', 'py')) {
        $command = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $command) { continue }
        $launchArguments = @()
        if ($candidate -eq 'py') { $launchArguments = @('-3') }
        if (Test-RecommendationPython -Executable $command.Source -LaunchArguments $launchArguments) {
            $selectedPython = $command.Source
            $selectedArguments = $launchArguments
            break
        }
    }
}

if (-not $selectedPython) {
    throw 'Install Python 3.12 from https://www.python.org/downloads/windows/ and run this setup again, or set GROCERY_PYTHON to an existing Python 3.10 through 3.13 executable.'
}

New-Item -ItemType Directory -Path $recommendationDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $environmentPython -PathType Leaf)) {
    Write-Host 'Creating the private recommendation Python environment...'
    & $selectedPython @selectedArguments -m venv $environmentDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Python could not create the recommendation environment. Install Python with its venv support and try again.' }
}
if (-not (Test-RecommendationPython -Executable $environmentPython)) {
    throw 'The existing recommendation environment uses an unsupported Python version. Choose Python 3.12 and recreate only .data/recommendations/venv before retrying.'
}

Write-Host 'Installing the pinned recommendation packages into the private environment...'
& $environmentPython -m pip install --disable-pip-version-check --requirement $requirementsPath
if ($LASTEXITCODE -ne 0) { throw 'Recommendation package installation failed. Check the internet connection and Python version, then rerun setup. The existing recommendation configuration was preserved.' }
& $environmentPython -c 'import numpy, scipy, sklearn; assert numpy.__version__ == "2.2.6"; assert scipy.__version__ == "1.15.3"; assert sklearn.__version__ == "1.7.2"'
if ($LASTEXITCODE -ne 0) { throw 'Recommendation package verification failed. The existing recommendation configuration was preserved.' }

$configurationPath = Join-Path $recommendationDirectory 'config.json'
$temporaryPath = Join-Path $recommendationDirectory ('config-' + [Guid]::NewGuid().ToString('N') + '.tmp')
$configuration = @{ pythonExecutable = [System.IO.Path]::GetFullPath($environmentPython) } | ConvertTo-Json
[System.IO.File]::WriteAllText($temporaryPath, $configuration, (New-Object System.Text.UTF8Encoding($false)))
try {
    if (Test-Path -LiteralPath $configurationPath -PathType Leaf) {
        [System.IO.File]::Replace($temporaryPath, $configurationPath, $null)
    } else {
        [System.IO.File]::Move($temporaryPath, $configurationPath)
    }
} finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) { Remove-Item -LiteralPath $temporaryPath }
}
Write-Host 'Recommendation setup is ready. The application can use this private Python environment.'
