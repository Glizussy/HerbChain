$ErrorActionPreference='Stop'
$hcAdb=Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'
if(!(Test-Path -LiteralPath $hcAdb)){throw 'Android platform-tools are missing. Install them through Android Studio.'}
$hcDevices=@(& $hcAdb devices | Select-Object -Skip 1 | Where-Object {$_ -match '^\S+\s+device\s*$'})
if($hcDevices.Count -ne 1){throw 'Connect exactly one unlocked Android phone with USB debugging authorized, then retry.'}
$hcSerial=($hcDevices[0] -split '\s+')[0]
& $hcAdb -s $hcSerial reverse tcp:3002 tcp:3002
if($LASTEXITCODE -ne 0){throw 'Could not connect the phone to the API port.'}
& $hcAdb -s $hcSerial reverse tcp:8082 tcp:8082
if($LASTEXITCODE -ne 0){throw 'Could not connect the phone to Metro.'}
$env:EXPO_PUBLIC_HERBCHAIN_API_URL='http://127.0.0.1:3002'
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$env:Path=(Join-Path $env:ANDROID_HOME 'platform-tools')+';'+$env:Path
Push-Location (Split-Path $PSScriptRoot -Parent)
try{
 Write-Host 'Keep the Ubuntu API running. Metro uses port 8082. Press a when Metro is ready to open the phone app.'
 & npx.cmd expo start --dev-client --localhost --port 8082 --clear
}finally{Pop-Location}
