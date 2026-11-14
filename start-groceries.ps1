$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$logDirectory = Join-Path $projectDirectory '.data\startup'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
while ($true) {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:4317/api/health' -TimeoutSec 4
        if ($health.application -eq 'home-grocery') {
            Start-Sleep -Seconds 10
            continue
        }
        # Do not start over an unrelated listener on the same port.
        throw 'Port 4317 is occupied by another application.'
    } catch {
        try {
            # CIM network queries can hang and prevent recovery after a crash.
            # A bounded loopback connection still protects unrelated listeners.
            $portOpen = $false
            $probe = [System.Net.Sockets.TcpClient]::new()
            try {
                $connection = $probe.ConnectAsync('127.0.0.1', 4317)
                if ($connection.Wait(1000)) { $portOpen = $probe.Connected }
            } catch { } finally { $probe.Dispose() }
            if ($portOpen) { Start-Sleep -Seconds 10; continue }
            $stdout = Join-Path $logDirectory 'server-output.log'
            $stderr = Join-Path $logDirectory 'server-error.log'
            foreach ($file in @($stdout, $stderr)) {
                if ((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).Length -gt 2MB) {
                    Move-Item -LiteralPath $file -Destination ($file + '.previous') -Force
                }
            }
            Start-Process -FilePath $nodeExecutable -ArgumentList @('"' + (Join-Path $projectDirectory 'server.js') + '"') -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Wait
        } catch {
            Add-Content -LiteralPath (Join-Path $logDirectory 'launcher.log') -Value ((Get-Date -Format o) + ' Grocery server start failed: ' + $_.Exception.Message)
        }
        Start-Sleep -Seconds 10
    }
}
