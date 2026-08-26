import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function bashResult(source: string, options: { stdin?: string; files?: Record<string, string>; locale?: string } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "virtual-bash-bugfix-"));
  try {
    for (const [name, value] of Object.entries(options.files ?? {})) writeFileSync(join(directory, name), value);
    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source, "bash-probe"], {
      cwd: directory, env: { PATH: "/usr/bin:/bin", LC_ALL: options.locale ?? "C", LANG: options.locale ?? "C", TZ: "UTC", HOME: directory },
      input: options.stdin ?? "", encoding: "utf8", timeout: 2000, maxBuffer: 262144,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    const files = Object.fromEntries(readdirSync(directory).map((name) => [name, readFileSync(join(directory, name), "utf8")]));
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status, files };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
