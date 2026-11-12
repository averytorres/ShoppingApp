param([ValidateSet('Start','Stop','Open','Uninstall','Firewall')][string]$Action='Open',[switch]$Quiet)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$marker=Join-Path $root 'installation.json'
if (!(Test-Path -LiteralPath $marker)) { throw 'This folder is not an installed Home Grocery application.' }
$config=Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
if ($config.product -ne 'Home Grocery' -or [IO.Path]::GetFullPath($config.installRoot) -ne $root) { throw 'Invalid installation record.' }
$node=Join-Path $root 'runtime\node.exe'
$server=Join-Path $root 'app\server.js'
$launcher=Join-Path $root 'installer\Run.ps1'
$startupLink=Join-Path ([Environment]::GetFolderPath('Startup')) 'Home Grocery.lnk'
$menu=Join-Path ([Environment]::GetFolderPath('Programs')) 'Home Grocery'
$url='http://127.0.0.1:'+$config.port
function Stop-OwnedProcesses {
    # Do not stop Node/Chrome or the source-checkout server belonging to anyone else.
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like ('*"'+$launcher+'"*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $node -and $_.CommandLine -like ('*"'+$server+'"*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
switch ($Action) {
    'Stop' { Stop-OwnedProcesses }
    'Start' { Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"'+$launcher+'"')) -WindowStyle Hidden }
    'Open' {
        & $PSCommandPath -Action Start
        for($i=0;$i -lt 30;$i++) { try { $health=Invoke-RestMethod ($url+'/api/health') -TimeoutSec 1; if($health.application -eq 'home-grocery'){break} } catch{}; Start-Sleep -Milliseconds 500 }
        Start-Process ($url+'/')
    }
    'Firewall' {
        $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Windows administrator approval is required to allow private-network access.' }
        foreach($entry in @(@('TCP',($config.port.ToString()+',80')),@('UDP','5353'))) {
            $name='Home Grocery '+$entry[0]+' '+$config.instance
            Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
            New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Profile Private -RemoteAddress LocalSubnet -Protocol $entry[0] -LocalPort ($entry[1].Split(',')) -Program $node | Out-Null
        }
    }
    'Uninstall' {
        if (!$Quiet) { Add-Type -AssemblyName System.Windows.Forms; if([Windows.Forms.MessageBox]::Show('Remove Home Grocery? Your household data and backups will be kept. Remove the helper separately in Chrome.','Uninstall Home Grocery','YesNo','Question') -ne 'Yes'){exit} }
        Stop-OwnedProcesses
        if (!$config.testInstall) {
            if (Test-Path -LiteralPath $startupLink) { $shell=New-Object -ComObject WScript.Shell; if($shell.CreateShortcut($startupLink).Arguments -like ('*'+$launcher+'*')) { Remove-Item -LiteralPath $startupLink } }
            if(Test-Path -LiteralPath $menu){Get-ChildItem -LiteralPath $menu -Filter '*.lnk' | ForEach-Object { $shell=New-Object -ComObject WScript.Shell; if($shell.CreateShortcut($_.FullName).Arguments -like ('*'+$root+'*')){Remove-Item -LiteralPath $_.FullName} }; if(!(Get-ChildItem -LiteralPath $menu)){Remove-Item -LiteralPath $menu} }
            Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\HomeGrocery' -ErrorAction SilentlyContinue
        }
        $data=[IO.Path]::GetFullPath($config.dataRoot)
        if($data.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Data folder is inside the program folder; automatic removal refused.'}
        if($root -eq [IO.Path]::GetPathRoot($root) -or !(Test-Path -LiteralPath (Join-Path $root 'runtime\node.exe'))){throw 'Unsafe uninstall path.'}
        # Check exact absolute marker root before recursive removal. Never remove the data directory.
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}
