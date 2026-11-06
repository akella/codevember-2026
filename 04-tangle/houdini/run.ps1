# Detached hython runner on the PC:  powershell -File run.ps1 -Script vellum_sim.py -Env "END=120,OUT=t0" -Log t0.log
param([string]$Script, [string]$Env = "", [string]$Log = "run.log")
Set-Location $PSScriptRoot
$env:HOUDINI_OCL_VENDOR = "NVIDIA Corporation"
$env:HOUDINI_OCL_DEVICETYPE = "GPU"
$env:HOUDINI_OCL_DEVICENUMBER = "0"
foreach ($kv in ($Env -split ',' | Where-Object { $_ })) { $k, $v = $kv.Split('=', 2); Set-Item "env:$k" $v }
$t = Measure-Command { & "C:\Program Files\Side Effects Software\Houdini 22.0.466\bin\hython.exe" $Script *> "logs\$Log" }
Add-Content "logs\$Log" ("EXIT {0:n0}s" -f $t.TotalSeconds)
