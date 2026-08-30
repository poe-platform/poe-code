import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { hash } from "./inspect.mjs";
import { supervise } from "./supervise.mjs";

const first = JSON.parse(readFileSync(process.argv[2], "utf8")), output = process.argv[3];
assert.equal(first.revision, "e36dab2b6abc216ddc89e5786a0eba76f08a1722");
assert.ok(output.startsWith("/tmp/full-gate-") && !existsSync(output)); mkdirSync(output);
const root = realpathSync(mkdtempSync("/tmp/full-gate-native-"));
const report = { revision: first.revision, startedAt: new Date().toISOString(), profile: "Darwin arm64; C; UTC; /bin/bash3.2 and separately pinned GNU5.3; argv0 shell-stress; no Linux or portable claim", rows: [] };
const cases = [
  ["move-output-really-closes-source", "{ printf moved >&4; printf lost >&3; printf 'status=%s' \"$?\"; } 3>saved 4>&3-"],
  ["move-input-really-closes-source", "{ IFS= read -r value <&4; printf '<%s>' \"$value\"; IFS= read -r missing <&3; printf 'status=%s' \"$?\"; } 3<input 4<&3-"],
  ["prevalidation-prior-output-and-file", 'printf before; printf marker >marker; printf "%s" "$(true |)"; printf after'],
  ["fatal-parameter-preserves-only-earlier-effects", 'printf before >before; : "${missing:?stop}"; printf after >after'],
  ["nested-substitution-syntax-error-does-not-prevent-earlier-effects", "printf touched >marker; printf '%s' \"$(true |)\""],
  ["fatal-parameter-expansion-prevents-following-file-effect", ': "${missing:?stop}"; : >after'],
  ["fatal-arithmetic-expansion-prevents-following-file-effect", ': "$((1/0))"; : >after'],
  ["fatal-expansion-in-substitution-stops-substitution-only", 'value=$(printf "%s" "${missing:?stop}"; printf wrong); printf "<%s>:%s\\n" "$value" "$?"'],
  ["command-substitution-removes-nul-bytes", 'value=$(printf "a\\0b"); printf "<%s>\\n" "$value"'],
];
try {
  const failures = first.phases.find(phase => phase.label === "test").accounting.nonpassing;
  for (const profile of ["bash3.2", "bash5.3"]) {
    const binary = first.native[profile]; assert.equal(binary.available, true); assert.equal(hash(readFileSync(binary.path)), binary.sha256);
    for (const [name, script] of cases) {
      const original = failures.find(row => row.status === "fail" && row.name.endsWith(": " + name)); assert.ok(original);
      assert.ok(original.detail.includes("    script: " + script + "\n"));
      const line = prefix => original.detail.split("\n").find(line => line.startsWith("    " + prefix + ": ")).slice(prefix.length + 6);
      const oldNative = JSON.parse(line("Bash")), virtual = JSON.parse(line("virtual"));
      const label = profile + "-" + name, directory = join(root, label); mkdirSync(directory);
      if (name === "move-input-really-closes-source") writeFileSync(join(directory, "input"), "first\nsecond\n");
      const result = await supervise(binary.path, ["--noprofile", "--norc", "-c", script, "shell-stress"], { cwd: directory,
        env: { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, LANG: "C", LC_ALL: "C", TZ: "UTC" }, timeoutMs: 3000,
        stdout: join(output, label + ".stdout.log"), stderr: join(output, label + ".stderr.log") });
      const stdout = readFileSync(join(output, label + ".stdout.log")), stderr = readFileSync(join(output, label + ".stderr.log"));
      const observed = { stdout: stdout.toString(), stderr: stderr.toString(), stdoutBase64: stdout.toString("base64"), stderrBase64: stderr.toString("base64"), exitCode: result.status,
        files: Object.fromEntries(readdirSync(directory).sort().map(name => [name, { type: "file", base64: readFileSync(join(directory, name)).toString("base64") }])) };
      if (profile === "bash3.2") assert.deepEqual(observed, oldNative, "Original native profile must reproduce without expected-value changes");
      report.rows.push({ name, profile, script, binary, result, observed, originalVirtual: virtual,
        exactMatchesVirtual: isDeepStrictEqual(observed, virtual), stdoutStatusFilesMatchVirtual: isDeepStrictEqual([observed.stdoutBase64, observed.exitCode, observed.files], [virtual.stdoutBase64, virtual.exitCode, virtual.files]) });
    }
  }
  report.status = "captured";
} catch (error) { report.status = "infrastructure-failed"; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  rmSync(root, { recursive: true, force: true }); report.temporaryRemoved = !existsSync(root); report.finishedAt = new Date().toISOString();
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, error: report.error, rows: report.rows.map(({ name, profile, exactMatchesVirtual, stdoutStatusFilesMatchVirtual }) => ({ name, profile, exactMatchesVirtual, stdoutStatusFilesMatchVirtual })), temporaryRemoved: report.temporaryRemoved }, null, 2));
}
