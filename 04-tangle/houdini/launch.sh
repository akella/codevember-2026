#!/bin/bash
# ./launch.sh "<ENV=v,ENV=v>" <log> [script]  -> copies the scripts over and starts a detached hython job on the PC
H=akell@100.73.214.25
D='C:\Users\akell\renders\houdini_tangle'
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT=${3:-vellum_sim.py}
NOISE="post-quantum\|store now\|upgraded\|pq.html"
scp -q "$HERE"/*.py "$HERE"/run.ps1 "$H:C:/Users/akell/renders/houdini_tangle/" 2>&1 | grep -v -i "$NOISE"
ssh $H "Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='powershell -NoProfile -ExecutionPolicy Bypass -File $D\\run.ps1 -Script $SCRIPT -Env \"$1\" -Log $2'; CurrentDirectory='$D'} | Select-Object -ExpandProperty ProcessId" 2>&1 | grep -v -i "$NOISE"
