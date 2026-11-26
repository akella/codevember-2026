#!/bin/zsh
# Waits till the PC's queue (queue.ps1) has baked a subject, then brings the model and the test views.  wait_bake.sh hero
cd "$(dirname "$0")"
N=$1
PC=${RENDER_HOST:?set RENDER_HOST to the PC, user@host}
O=(-o LogLevel=ERROR -o BatchMode=yes -o ConnectTimeout=20)
for k in {1..900}; do
  t=$(ssh "${O[@]}" $PC "Get-Content renders/cocoon_hero/pipe.txt -Tail 40" 2>/dev/null | tr -d '\r')
  if [[ $t == *"$N BAKED"* ]]; then
    mkdir -p data/${N}_run data/${N}_test
    scp -q "${O[@]}" "${PC}:renders/cocoon_hero/data/${N}_run/model.pt" data/${N}_run/
    scp -q "${O[@]}" "${PC}:renders/cocoon_hero/data/${N}_test/*" data/${N}_test/
    scp -q "${O[@]}" "${PC}:renders/cocoon_hero/train_$N.txt" data/${N}_run/train.txt
    print -r -- "$t" | tail -12; tail -6 data/${N}_run/train.txt; exit 0
  fi
  sleep 40
done
echo "not done after all this time: $t"; exit 1
