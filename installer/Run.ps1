$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$config=Get-Content -LiteralPath (Join-Path $root 'installation.json') -Raw | ConvertFrom-Json
$mutex=New-Object Threading.Mutex($false,('Local\HomeGrocery-'+$config.instance))
if(!$mutex.WaitOne(0)){exit}
try {
    $env:GROCERY_DATA_DIR=$config.dataRoot
    $env:PORT=$config.port.ToString()
    if($config.testInstall){$env:HOST='127.0.0.1';$env:GROCERY_ALIAS='0'}
    $logs=Join-Path $config.dataRoot 'startup'
    New-Item -ItemType Directory -Force -Path $logs | Out-Null
    while($true) {
        try {
            $listener=Get-NetTCPConnection -LocalPort $config.port -State Listen -ErrorAction SilentlyContinue
            if($listener){Add-Content -LiteralPath (Join-Path $logs 'launcher.log') -Value ((Get-Date -Format o)+' Port already in use; not replacing another server.');Start-Sleep -Seconds 10;continue}
            $stdout=Join-Path $logs 'server-output.log';$stderr=Join-Path $logs 'server-error.log'
            foreach($file in @($stdout,$stderr)){if((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).Length -gt 2MB){Move-Item -LiteralPath $file -Destination ($file+'.previous') -Force}}
            Start-Process -FilePath (Join-Path $root 'runtime\node.exe') -ArgumentList ('"'+(Join-Path $root 'app\server.js')+'"') -WorkingDirectory (Join-Path $root 'app') -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Wait
        }catch{Add-Content -LiteralPath (Join-Path $logs 'launcher.log') -Value ((Get-Date -Format o)+' '+$_.Exception.Message)}
        Start-Sleep -Seconds 10
    }
}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
