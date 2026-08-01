#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

mkdir -p "$test_root/bin" "$test_root/xcsh bin" "$test_root/run/scripts"

cat >"$test_root/bin/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
shift
exec "$@"
EOF
chmod +x "$test_root/bin/timeout"

cat >"$test_root/xcsh bin/xcsh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" >"$SWEEP_TEST_ARGS"
printf '%s\n' '{"resource":"namespace","steps_total":1,"steps_passed":1,"failed_step":null,"error":null}'
EOF
chmod +x "$test_root/xcsh bin/xcsh"

(
  cd "$test_root/run"
  env -u XCSH_NAMESPACE \
    PATH="$test_root/bin:$PATH" \
    SWEEP_TEST_ARGS="$test_root/args" \
    XCSH_BIN="$test_root/xcsh bin/xcsh" \
    bash "$repo_root/scripts/create-sweep.sh" namespace >/dev/null
)

grep -qx -- '-p' "$test_root/args"
grep -q 'namespace=demo-app' "$test_root/args"

if grep -Eq '/Users/[^${}<>/]+|/home/[^${}<>/]+' "$repo_root/scripts/create-sweep.sh"; then
  echo "create-sweep contains a workstation-specific home path" >&2
  exit 1
fi

echo "create-sweep portability test passed"
