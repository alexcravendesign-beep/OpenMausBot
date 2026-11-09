import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { removeTempDir } from "./testing/cleanup.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "inhouse/full-test.sh");

interface SyntheticRunOptions {
  vitestExit: number;
  brokerExit?: number;
  electronExit?: number;
  packagedExit?: number;
  reportContent?: string | null;
  staleReportContent?: string;
  knownFailures?: string;
}

function runFullTestWithStub(options: SyntheticRunOptions) {
  const dir = mkdtempSync(join(tmpdir(), "omb-full-test-"));
  const binDir = join(dir, "bin");
  mkdirSync(join(dir, "inhouse/logs"), { recursive: true });
  mkdirSync(binDir, { recursive: true });

  writeFileSync(join(dir, "inhouse/full-test.sh"), readFileSync(scriptPath, "utf8"), { mode: 0o755 });
  if (options.knownFailures !== undefined) {
    writeFileSync(join(dir, "inhouse/known-failures.txt"), options.knownFailures);
  }

  const sha = "abc123456";
  if (options.staleReportContent !== undefined) {
    writeFileSync(join(dir, `inhouse/logs/full-test-${sha}.json`), options.staleReportContent);
  }
  writeFileSync(join(dir, "inhouse/logs/full-test.ok"), "oldsha\n");

  const gitStub = `#!/usr/bin/env bash
echo "${sha}"
`;
  writeFileSync(join(binDir, "git"), gitStub, { mode: 0o755 });

  const reportPayloadPath = join(dir, "synthetic-report.txt");
  if (options.reportContent !== undefined && options.reportContent !== null) {
    writeFileSync(reportPayloadPath, options.reportContent);
  }

  const pnpmStub = `#!/usr/bin/env bash
case "$1" in
  vitest)
    for arg in "$@"; do
      case "$arg" in
        --outputFile.json=*)
          out="\${arg#--outputFile.json=}"
          if [ -f "${reportPayloadPath}" ]; then
            cp "${reportPayloadPath}" "$out"
          fi
          ;;
      esac
    done
    exit ${options.vitestExit}
    ;;
  broker:test) exit ${options.brokerExit ?? 0} ;;
  test:electron) exit ${options.electronExit ?? 0} ;;
  test:packaged-server) exit ${options.packagedExit ?? 0} ;;
  *) exit 1 ;;
esac
`;
  writeFileSync(join(binDir, "pnpm"), pnpmStub, { mode: 0o755 });

  const result = spawnSync("bash", [join(dir, "inhouse/full-test.sh")], {
    cwd: dir,
    env: { ...process.env, HOME: dir, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    encoding: "utf8",
  });

  const logPath = join(dir, `inhouse/logs/full-test-${sha}.log`);
  const okPath = join(dir, "inhouse/logs/full-test.ok");
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  const ok = existsSync(okPath) ? readFileSync(okPath, "utf8").trim() : null;
  removeTempDir(dir);
  return { status: result.status, log, ok, sha };
}

describe("inhouse/full-test.sh result parsing and gate", () => {
  it("marks GREEN, exits 0, and writes full-test.ok on a clean report", () => {
    const report = JSON.stringify({
      numTotalTests: 2,
      numPassedTests: 2,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [
        {
          name: "server/example.test.ts",
          status: "passed",
          assertionResults: [
            { fullName: "suite > passes 1", status: "passed" },
            { fullName: "suite > passes 2", status: "passed" },
          ],
        },
      ],
    });
    const res = runFullTestWithStub({ vitestExit: 0, reportContent: report });
    expect(res.status).toBe(0);
    expect(res.ok).toBe(res.sha);
    expect(res.log).toContain(`== GREEN ${res.sha}`);
  });

  it("marks GREEN when the only failing assertion is in known-failures.txt", () => {
    const report = JSON.stringify({
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      numPendingTests: 0,
      testResults: [
        {
          name: "server/cloud-lending.e2e.test.ts",
          status: "failed",
          assertionResults: [
            { fullName: "suite > passes", status: "passed" },
            { fullName: "suite > known environmental timeout", status: "failed" },
          ],
        },
      ],
    });
    const res = runFullTestWithStub({
      vitestExit: 1,
      reportContent: report,
      knownFailures: "server/cloud-lending.e2e.test.ts :: suite > known environmental timeout\n",
    });
    expect(res.status).toBe(0);
    expect(res.ok).toBe(res.sha);
    expect(res.log).toContain(`== GREEN ${res.sha}`);
  });

  it("marks RED and exits non-zero on an unexpected assertion failure", () => {
    const report = JSON.stringify({
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      numPendingTests: 0,
      testResults: [
        {
          name: "server/regression.test.ts",
          status: "failed",
          assertionResults: [
            { fullName: "suite > passes", status: "passed" },
            { fullName: "suite > unexpected regression", status: "failed" },
          ],
        },
      ],
    });
    const res = runFullTestWithStub({
      vitestExit: 1,
      reportContent: report,
      knownFailures: "server/cloud-lending.e2e.test.ts :: suite > known environmental timeout\n",
    });
    expect(res.status).not.toBe(0);
    expect(res.ok).toBeNull();
    expect(res.log).toContain(`== RED ${res.sha}`);
  });

  it("marks RED and exits non-zero when vitest exits non-zero with 0 assertion failures (suite load / runtime error)", () => {
    const report = JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [
        {
          name: "server/broken-import.test.ts",
          status: "failed",
          assertionResults: [],
        },
      ],
    });
    const res = runFullTestWithStub({ vitestExit: 1, reportContent: report });
    expect(res.status).not.toBe(0);
    expect(res.ok).toBeNull();
    expect(res.log).toContain(`== RED ${res.sha}`);
  });

  it("marks RED and exits non-zero on truncated / malformed JSON", () => {
    const res = runFullTestWithStub({
      vitestExit: 0,
      reportContent: '{"numTotalTests": 10, "numFailedTests": 0, "testResults": [',
    });
    expect(res.status).not.toBe(0);
    expect(res.ok).toBeNull();
    expect(res.log).toContain(`== RED ${res.sha}`);
  });

  it("marks RED and exits non-zero when no JSON report is produced, even if a stale report existed before the run", () => {
    const staleGreenReport = JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [{ name: "server/ok.test.ts", status: "passed", assertionResults: [{ fullName: "ok", status: "passed" }] }],
    });
    const res = runFullTestWithStub({
      vitestExit: 1,
      reportContent: null,
      staleReportContent: staleGreenReport,
    });
    expect(res.status).not.toBe(0);
    expect(res.ok).toBeNull();
    expect(res.log).toContain("vitest produced no json");
    expect(res.log).toContain(`== RED ${res.sha}`);
  });
});
