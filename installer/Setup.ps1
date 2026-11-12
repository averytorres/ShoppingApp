param([switch]$Silent,[string]$InstallRoot,[string]$DataRoot,[string]$HouseholdName='Our household',[ValidateSet('HEB','Walmart')][string]$Store='HEB',[switch]$NoStartup,[switch]$NoLaunch,[switch]$TestInstall,[int]$Port=4317)
$ErrorActionPreference='Stop'
$payload=Split-Path $PSScriptRoot -Parent
if(!$InstallRoot){$InstallRoot=Join-Path $env:LOCALAPPDATA 'Programs\HomeGrocery'}
if(!$DataRoot){$DataRoot=Join-Path $env:LOCALAPPDATA 'HomeGrocery\data'}
function Install-HomeGrocery {
    param([bool]$StartupEnabled,[bool]$AllowNetwork)
    $root=[IO.Path]::GetFullPath($InstallRoot);$data=[IO.Path]::GetFullPath($DataRoot)
    if($root -eq [IO.Path]::GetPathRoot($root) -or $root -eq $data -or $data.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or $root.StartsWith($data+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Choose separate program and household-data folders.'}
    if(!$TestInstall -and $Port -ne 4317){throw 'The browser helper requires port 4317.'}
    $name=$HouseholdName.Trim();if(!$name -or $name.Length -gt 60){throw 'Enter a household name of 1 to 60 characters.'}
    $manifest=Get-Content -LiteralPath (Join-Path $payload 'payload-manifest.json') -Raw | ConvertFrom-Json
    if($manifest.product -ne 'Home Grocery'){throw 'Invalid installer payload.'}
    foreach($entry in $manifest.files){$file=[IO.Path]::GetFullPath((Join-Path $payload $entry.path));if(!$file.StartsWith($payload+'\',[StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256){throw 'Installer integrity check failed. Download a fresh copy.'}}
    $old=$null;$marker=Join-Path $root 'installation.json'
    if(Test-Path -LiteralPath $root){if(!(Test-Path -LiteralPath $marker)){throw 'The program folder already exists without a Home Grocery installation. Choose another folder.'};$old=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json;if($old.product -ne 'Home Grocery' -or [IO.Path]::GetFullPath($old.installRoot) -ne $root -or [IO.Path]::GetFullPath($old.dataRoot) -ne $data){throw 'Existing installation paths do not match.'}}
    $listeners=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    foreach($listener in $listeners){$owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listener.OwningProcess);if(!$old -or $owner.ExecutablePath -ne (Join-Path $root 'runtime\node.exe')){throw "Port $Port is already used by another application or an existing source installation. Setup will not replace it. Use that installation, or stop it before installing."}}
    if($old){& (Join-Path $root 'installer\Manage.ps1') -Action Stop}
    New-Item -ItemType Directory -Force -Path $root,$data | Out-Null
    if(Test-Path -LiteralPath (Join-Path $data 'groceries.sqlite')) {
        & (Join-Path $root 'runtime\node.exe') (Join-Path $root 'app\backup.js') create $data | Out-Null
        if($LASTEXITCODE -ne 0){throw 'Existing household backup failed; update canceled.'}
    }
    # Stage first; keep a code rollback copy until the updated server passes health checks.
    $rollback=Join-Path $root ('rollback-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $rollback | Out-Null
    $moved=@();$copied=@()
    try {
        foreach($folder in @('app','runtime','installer')){if(Test-Path -LiteralPath (Join-Path $root $folder)){Move-Item -LiteralPath (Join-Path $root $folder) -Destination (Join-Path $rollback $folder);$moved+=$folder};Copy-Item -LiteralPath (Join-Path $payload $folder) -Destination (Join-Path $root $folder) -Recurse;$copied+=$folder}
        $config=[ordered]@{product='Home Grocery';version=$manifest.version;installRoot=$root;dataRoot=$data;port=$Port;householdName=$name;store=$Store;instance=if($old){$old.instance}else{[guid]::NewGuid().ToString('N')};testInstall=[bool]$TestInstall}
        $config|ConvertTo-Json|Set-Content -LiteralPath $marker -Encoding UTF8
        $settings=Join-Path $data 'installation-settings.json'
        if(!(Test-Path -LiteralPath $settings)){@{householdName=$name;preferredStore=$Store}|ConvertTo-Json|Set-Content -LiteralPath $settings -Encoding UTF8}
        & (Join-Path $root 'installer\Manage.ps1') -Action Start
        $healthy=$false
        for($i=0;$i -lt 40;$i++){try{$health=Invoke-RestMethod ("http://127.0.0.1:$Port/api/health") -TimeoutSec 1;if($health.application -eq 'home-grocery'){$healthy=$true;break}}catch{};Start-Sleep -Milliseconds 500}
        if(!$healthy){throw 'The installed server did not start. See startup logs in your household data folder.'}
    }catch {
        $failure=$_
        if(Test-Path -LiteralPath $marker){try{& (Join-Path $root 'installer\Manage.ps1') -Action Stop}catch{}}
        foreach($folder in $copied){$target=[IO.Path]::GetFullPath((Join-Path $root $folder));if($target.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue}}
        foreach($folder in $moved){Move-Item -LiteralPath (Join-Path $rollback $folder) -Destination (Join-Path $root $folder)}
        if($old){$old|ConvertTo-Json|Set-Content -LiteralPath $marker -Encoding UTF8;& (Join-Path $root 'installer\Manage.ps1') -Action Start}
        throw $failure
    }
    if([IO.Path]::GetFullPath($rollback).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $rollback -Recurse -Force}
    if(!$TestInstall){
        $shell=New-Object -ComObject WScript.Shell
        $menu=Join-Path ([Environment]::GetFolderPath('Programs')) 'Home Grocery';New-Item -ItemType Directory -Force -Path $menu|Out-Null
        foreach($action in @('Open','Stop','Uninstall')){$shortcut=$shell.CreateShortcut((Join-Path $menu ($action+' Home Grocery.lnk')));$shortcut.TargetPath=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe';$shortcut.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $root 'installer\Manage.ps1')+'" -Action '+$action;$shortcut.WindowStyle=7;$shortcut.Save()}
        $guide=$shell.CreateShortcut((Join-Path $menu 'Connect browsers and phones.lnk'));$guide.TargetPath='http://127.0.0.1:4317/install';$guide.Save()
        $extension=$shell.CreateShortcut((Join-Path $menu 'Chrome extension folder.lnk'));$extension.TargetPath=Join-Path $root 'app\walmart-extension';$extension.Save()
        $startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Home Grocery.lnk'
        if($StartupEnabled){$shortcut=$shell.CreateShortcut($startup);$shortcut.TargetPath=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe';$shortcut.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $root 'installer\Run.ps1')+'"';$shortcut.WindowStyle=7;$shortcut.Save()}elseif(Test-Path -LiteralPath $startup){if($shell.CreateShortcut($startup).Arguments -like ('*'+$root+'*')){Remove-Item -LiteralPath $startup}}
        $registry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\HomeGrocery';New-Item -Path $registry -Force|Out-Null
        $values=@{DisplayName='Home Grocery';DisplayVersion=$manifest.version;InstallLocation=$root;Publisher='Home Grocery';UninstallString=('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $root 'installer\Manage.ps1')+'" -Action Uninstall')}
        foreach($key in $values.Keys){Set-ItemProperty -LiteralPath $registry -Name $key -Value $values[$key]}
        if($AllowNetwork){try{$admin=Start-Process powershell.exe -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $root 'installer\Manage.ps1')+'" -Action Firewall') -Wait -PassThru -WindowStyle Hidden;if($admin.ExitCode -ne 0){throw 'Windows did not allow the firewall change.'}}catch{if(!$Silent){[Windows.Forms.MessageBox]::Show('Installed successfully. Private-network access was not enabled. You can use this PC now and enable network access later from setup.','Home Grocery')|Out-Null}}}
    }
    if($NoLaunch){& (Join-Path $root 'installer\Manage.ps1') -Action Stop}else{Start-Process ("http://127.0.0.1:$Port/install")}
    return $root
}
if($Silent){if(!$TestInstall){throw 'Silent mode is reserved for isolated installer verification.'};Install-HomeGrocery -StartupEnabled $false -AllowNetwork $false;exit}
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form=New-Object Windows.Forms.Form;$form.Text='Install Home Grocery';$form.ClientSize=New-Object Drawing.Size(590,530);$form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false;$form.Font=New-Object Drawing.Font('Segoe UI',10)
function Label-Control($text,$x,$y,$width,$height){$label=New-Object Windows.Forms.Label;$label.Text=$text;$label.SetBounds($x,$y,$width,$height);$form.Controls.Add($label)}
Label-Control 'A little less to remember.' 28 22 530 38
Label-Control 'Install on the PC that stays on. Phones and other laptops use the website. No Node installation or store passwords are needed here.' 28 65 530 62
Label-Control 'Household name' 28 137 530 22
$nameInput=New-Object Windows.Forms.TextBox;$nameInput.Text=$HouseholdName;$nameInput.MaxLength=60;$nameInput.SetBounds(28,163,530,28);$form.Controls.Add($nameInput)
Label-Control 'Main grocery store' 28 207 530 22
$storeInput=New-Object Windows.Forms.ComboBox;$storeInput.DropDownStyle='DropDownList';$storeInput.Items.AddRange(@('H-E-B','Walmart'));$storeInput.SelectedIndex=0;$storeInput.SetBounds(28,233,530,28);$form.Controls.Add($storeInput)
$startupInput=New-Object Windows.Forms.CheckBox;$startupInput.Text='Start quietly when I sign into Windows';$startupInput.Checked=$true;$startupInput.SetBounds(28,281,530,28);$form.Controls.Add($startupInput)
$networkInput=New-Object Windows.Forms.CheckBox;$networkInput.Text='Allow phones on my private home network (Windows approval)';$networkInput.Checked=$true;$networkInput.SetBounds(28,315,540,28);$form.Controls.Add($networkInput)
Label-Control 'Next: approve the Chrome helper and sign into your stores. Household data stays on this PC; updates preserve it. Uninstall keeps your data.' 28 361 530 60
$status=New-Object Windows.Forms.Label;$status.SetBounds(28,427,530,36);$form.Controls.Add($status)
$install=New-Object Windows.Forms.Button;$install.Text='Install Home Grocery';$install.SetBounds(310,475,248,34);$form.Controls.Add($install);$form.AcceptButton=$install
$install.Add_Click({$install.Enabled=$false;$form.UseWaitCursor=$true;$status.Text='Checking and installing. Please keep this window open.';$form.Refresh();try{$script:HouseholdName=$nameInput.Text;$script:Store=if($storeInput.SelectedIndex -eq 0){'HEB'}else{'Walmart'};Install-HomeGrocery -StartupEnabled $startupInput.Checked -AllowNetwork $networkInput.Checked|Out-Null;[Windows.Forms.MessageBox]::Show('Home Grocery is ready. Continue with the connection guide in your browser.','Home Grocery')|Out-Null;$form.Close()}catch{$status.Text='Installation was not completed.';[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Home Grocery','OK','Error')|Out-Null;$install.Enabled=$true}finally{$form.UseWaitCursor=$false}})
[void]$form.ShowDialog()
