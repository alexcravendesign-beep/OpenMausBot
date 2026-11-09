#!/usr/bin/env bash
# The whole upstream suite on this box: ~30k vitest cases + broker + electron + packaged-server, ~3.5 h.
# Run it detached:   nohup inhouse/full-test.sh >/dev/null 2>&1 &     watch: tail -f inhouse/logs/full-test-<sha>.log
# Writes inhouse/logs/full-test-<sha>.{log,json,failures}. Failures listed in inhouse/known-failures.txt
# (environmental, one "file :: test name" per line) do not count. Green -> inhouse/logs/full-test.ok = sha,
# which release.sh requires for HEAD.
set -uo pipefail
export PATH=$HOME/.local/bin:$PATH NODE_OPTIONS=--max-old-space-size=8192
cd "$(dirname "$0")/.."
LOG=inhouse/logs; mkdir -p "$LOG"; touch inhouse/known-failures.txt
sha=$(git rev-parse --short HEAD)
log=$LOG/full-test-$sha.log; json=$LOG/full-test-$sha.json; fails=$LOG/full-test-$sha.failures
rm -f "$LOG/full-test.ok" "$json" "$fails"
{
  echo "== full test of $sha started $(date '+%F %T')"
  pnpm vitest run --testTimeout=60000 --reporter=dot --reporter=json --outputFile.json="$json"; v=$?  # 60 s: this VM is ~3x slower than upstream CI
  echo "== vitest exit $v  $(date +%T)"
  pnpm broker:test;          b=$?; echo "== broker:test exit $b  $(date +%T)"
  pnpm test:electron;        e=$?; echo "== test:electron exit $e  $(date +%T)"
  pnpm test:packaged-server; p=$?; echo "== test:packaged-server exit $p  $(date +%T)"
  j=1; f=0; s=0; unexpected=""
  if [ -s "$json" ]; then
    counts=$(node -e '
      const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      if (r && typeof r.numTotalTests === "number" && r.numTotalTests > 0 && Array.isArray(r.testResults)) {
        console.error(`vitest: ${r.numFailedTests} failed, ${r.numPassedTests} passed, ${r.numPendingTests} skipped of ${r.numTotalTests}`);
        let suites = 0;
        for (const t of r.testResults) {
          let af = 0;
          for (const a of t.assertionResults || [])
            if (a.status === "failed") { af++; console.log(`${t.name.replace(process.cwd() + "/", "")} :: ${a.fullName}`); }
          if (t.status === "failed" && af === 0) suites++;
        }
        process.stderr.write(`COUNTS=${r.numFailedTests}:${suites}\n`);
      } else process.exit(2);
    ' "$json" 2>&1 > "$fails"); j=$?
    echo "$counts" | grep -v '^COUNTS='
    if [ $j -eq 0 ]; then
      f=$(echo "$counts" | sed -n 's/^COUNTS=\([0-9]*\):.*/\1/p')
      s=$(echo "$counts" | sed -n 's/^COUNTS=[0-9]*:\([0-9]*\)/\1/p')
      unexpected=$(grep -vxFf inhouse/known-failures.txt "$fails" || true)
      echo "== failing vitest cases ($(wc -l < "$fails" | tr -d ' ') total, listed in $fails):"; cat "$fails"
      echo "== not in known-failures.txt: $(printf '%s' "$unexpected" | grep -c . || true)"
    else
      unexpected="vitest json malformed or incomplete (parse exit $j)"; echo "== $unexpected"
    fi
  else
    unexpected="vitest produced no json (crashed?)"; echo "== $unexpected"
  fi
  if [ $j -eq 0 ] && [ "${s:-1}" -eq 0 ] && { [ $v -eq 0 ] || [ "${f:-0}" -gt 0 ]; } && [ -z "$unexpected" ] && [ $((b + e + p)) -eq 0 ]; then
    echo "$sha" > "$LOG/full-test.ok"; echo "== GREEN $sha $(date '+%F %T')"
  else
    echo "== RED $sha $(date '+%F %T')"; exit 1
  fi
} > "$log" 2>&1

