#!/bin/bash
# bash sim/live-sweep.sh "preset=knot" "preset=knot&pull=8" ...: the shake meter over a list of settings
for q in "$@"; do node sim/live-run.mjs "http://localhost:5174/sim/live-jitter.html?$q" 120 2>&1 | grep -E "\[jitter\]|ERROR|FAILED" | sed 's/\[jitter\] //'; done
