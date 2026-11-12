param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist'))
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$stage = Join-Path ([IO.Path]::GetTempPath()) ('HomeGrocery-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    $payload = Join-Path $stage 'payload'
    $app = Join-Path $payload 'app'
    New-Item -ItemType Directory -Path $app | Out-Null
    # Explicit allowlist: no Git history, .data, photos, receipts, profiles, logs or local operational notes.
    Get-ChildItem -LiteralPath $root -File -Filter '*.js' | Copy-Item -Destination $app
    foreach ($file in @('package.json','package-lock.json')) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination $app }
    foreach ($folder in @('web','walmart-extension')) {
        New-Item -ItemType Directory -Path (Join-Path $app $folder) | Out-Null
        Get-ChildItem -LiteralPath (Join-Path $root $folder) -File | Where-Object { $_.Extension -in @('.js','.html','.css','.json','.csv') } | Copy-Item -Destination (Join-Path $app $folder)
    }
    Copy-Item -LiteralPath $PSScriptRoot -Destination (Join-Path $payload 'installer') -Recurse
    Remove-Item -LiteralPath (Join-Path $payload 'installer\Build.ps1'),(Join-Path $payload 'installer\Bootstrap.cs')
    $runtime = Join-Path $payload 'runtime'
    New-Item -ItemType Directory -Path $runtime | Out-Null
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $signature = Get-AuthenticodeSignature -LiteralPath $node
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'OpenJS Foundation') { throw 'Build requires a valid OpenJS-signed Windows Node runtime.' }
    $architecture = & $node -p 'process.arch'
    if ($architecture -ne 'x64') { throw 'This installer currently supports Windows x64 only.' }
    Copy-Item -LiteralPath $node -Destination (Join-Path $runtime 'node.exe')
    $nodeVersion = & $node --version
    Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/nodejs/node/'+$nodeVersion+'/LICENSE') -OutFile (Join-Path $runtime 'NODE-LICENSE.txt')
    Push-Location $app
    try { & npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } } finally { Pop-Location }
    $version = (Get-Content (Join-Path $root 'walmart-extension\manifest.json') -Raw | ConvertFrom-Json).version
    $manifest = [ordered]@{ product='Home Grocery'; version=$version; architecture='x64'; node=(& $node --version); files=@() }
    $manifest.files = @(Get-ChildItem -LiteralPath $payload -File -Recurse | ForEach-Object { @{path=$_.FullName.Substring($payload.Length+1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} })
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $payload 'payload-manifest.json') -Encoding UTF8
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = Join-Path $stage 'payload.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($payload,$archive)
    New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    $output = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) 'Install Home Grocery.exe'
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $compiler /nologo /target:winexe /platform:x64 "/out:$output" /reference:System.Windows.Forms.dll /reference:System.IO.Compression.FileSystem.dll "/resource:$archive,payload.zip" (Join-Path $PSScriptRoot 'Bootstrap.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
    $hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  Install Home Grocery.exe" | Set-Content -LiteralPath (Join-Path $OutputDirectory 'SHA256SUMS.txt') -Encoding ASCII
    Write-Output ([pscustomobject]@{installer=$output;sha256=$hash;version=$version;files=$manifest.files.Count} | ConvertTo-Json)
} finally {
    if ([IO.Path]::GetFullPath($stage).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $stage -Leaf) -like 'HomeGrocery-build-*') { Remove-Item -LiteralPath $stage -Recurse -Force }
}
