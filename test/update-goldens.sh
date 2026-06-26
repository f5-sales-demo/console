#!/usr/bin/env bash
#
# Refresh the golden create-workflow snapshots after an intentional generator
# or field-metadata change.
#
# Regenerates all workflows from api-specs-enriched (preserving hand-crafted
# confidence:validated files), then copies each catalog create.yaml over its
# committed golden snapshot. Run from the repo root or anywhere — paths are
# resolved relative to this script.
#
# Usage:
#   bash test/update-goldens.sh
#
# After running, review `git diff test/golden/` and re-run `bun test` to
# confirm the golden-diff gate passes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GOLDEN_DIR="${SCRIPT_DIR}/golden"
WORKFLOWS_DIR="${REPO_ROOT}/catalog/workflows"

echo "Regenerating workflows from api-specs-enriched..."
bun "${REPO_ROOT}/scripts/generate-workflows.ts"

echo "Refreshing golden snapshots in ${GOLDEN_DIR}..."
updated=0
missing=0
for golden in "${GOLDEN_DIR}"/*-create.yaml; do
  resource="$(basename "${golden}" -create.yaml)"
  current="${WORKFLOWS_DIR}/${resource}/create.yaml"
  if [[ -f "${current}" ]]; then
    cp "${current}" "${golden}"
    updated=$((updated + 1))
  else
    echo "  WARN: no generated create.yaml for '${resource}' (golden left unchanged)"
    missing=$((missing + 1))
  fi
done

echo "Done: ${updated} goldens refreshed, ${missing} missing."
echo "Next: review 'git diff test/golden/' and run 'bun test'."
