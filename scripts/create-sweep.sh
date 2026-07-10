#!/usr/bin/env bash
#
# Sweep: run catalog_workflow_runner create for a list of resources and
# collect per-resource pass/fail. Requires a running xcsh agent with a
# WebSocket bridge on :19222 and the Chrome extension connected.
#
# Usage:
#   bash scripts/create-sweep.sh [resource1 resource2 ...]
#   bash scripts/create-sweep.sh   # (no args = all resources sorted by complexity)
#
# Each resource runs as a separate xcsh -p invocation so a failure doesn't
# block the next. Results are appended to scripts/sweep-results.jsonl.
set -euo pipefail

RESULTS="scripts/sweep-results.jsonl"
XCSH="${XCSH_BIN:-bun --cwd=/Users/r.mordasiewicz/GIT/web-search/xcsh/packages/coding-agent src/cli.ts}"
NS="${XCSH_NAMESPACE:-r-mordasiewicz}"

if [ $# -gt 0 ]; then
  RESOURCES=("$@")
else
  # All resources with create workflows, sorted by step count (simplest first)
  mapfile -t RESOURCES < <(
    for d in catalog/workflows/*/; do
      r=$(basename "$d")
      [ -f "$d/create.yaml" ] || continue
      steps=$(grep -c "^  - id:" "$d/create.yaml" 2>/dev/null || echo 99)
      echo "$steps $r"
    done | sort -n | awk '{print $2}'
  )
fi

echo "Sweeping ${#RESOURCES[@]} resources..."
for r in "${RESOURCES[@]}"; do
  NAME="xcsh-sweep-${r}"
  echo -n "  $r ... "

  # Run the create workflow via xcsh -p (timeout 120s per resource)
  LOG="/tmp/sweep-${r}.log"
  timeout 120 $XCSH -p "Use catalog_workflow_runner to create resource=$r with params namespace=$NS name=$NAME. Report ONLY a JSON object: {\"resource\":\"$r\",\"steps_total\":N,\"steps_passed\":N,\"failed_step\":\"id or null\",\"error\":\"msg or null\"}. Nothing else — just the JSON." >"$LOG" 2>/dev/null || true

  # Extract the JSON result (last line that looks like JSON)
  RESULT=$(grep -E '^\{' "$LOG" 2>/dev/null | tail -1)
  if [ -n "$RESULT" ]; then
    echo "$RESULT" >>"$RESULTS"
    passed=$(echo "$RESULT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('steps_passed','?'))" 2>/dev/null)
    total=$(echo "$RESULT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('steps_total','?'))" 2>/dev/null)
    echo "${passed}/${total}"
  else
    echo '{"resource":"'"$r"'","error":"no output (timeout or crash)"}' >>"$RESULTS"
    echo "NO OUTPUT"
  fi
done

echo "Results in $RESULTS"
echo "Summary:"
python3 -c "
import json
results = [json.loads(l) for l in open('$RESULTS') if l.strip()]
passed = sum(1 for r in results if r.get('steps_passed') == r.get('steps_total') and r.get('steps_total'))
failed = sum(1 for r in results if r.get('failed_step') or r.get('error'))
print(f'  {passed}/{len(results)} fully passed, {failed} with failures')
" 2>/dev/null || true
