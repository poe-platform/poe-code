import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executable = process.argv[2];
assert.ok(executable, "Pass the explicit pinned Bash executable");
const cases: [string, string][] = [
  ["independent skipped body", "printf before >before; false && cat <<EOF\n$(true |)\nEOF\nprintf after >after"],
  ["external malformed substitution", "printf before >before; cat <<EOF\nhead $(true |) tail $(printf good >inner; printf good)\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["builtin malformed substitution", "printf before >before; : <<EOF\nhead $(true |) tail $(printf good >inner)\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["function malformed substitution", "call() { cat; }; printf before >before; call <<EOF\nhead $(true |) tail\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["group malformed substitution", "printf before >before; { cat; } <<EOF\nhead $(true |) tail\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["unselected branch", "printf before >before; if false; then cat <<EOF\n$(true |) ${bad!}\nEOF\nfi; printf after >after"],
  ["unused function", "printf before >before; never() { cat <<EOF\n$(true |) ${bad!}\nEOF\n}; printf after >after"],
  ["invoked function body", "call() { cat <<EOF\n$(true |)\nEOF\n}; printf before >before; call; printf 'status=%s' \"$?\"; printf after >after"],
  ["skipped malformed parameter", "printf before >before; false && cat <<EOF\n${bad!}\nEOF\nprintf after >after"],
  ["external malformed parameter", "printf before >before; cat <<EOF\nhead ${bad!} tail\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["builtin malformed parameter", "printf before >before; : <<EOF\nhead ${bad!} tail\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["function malformed parameter", "call() { cat; }; printf before >before; call <<EOF\nhead ${bad!} tail\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["group malformed parameter", "printf before >before; { cat; } <<EOF\nhead ${bad!} tail\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["quoted literal control", "printf before >before; cat <<'EOF'\n$(true |) ${bad!} $((1+))\nEOF\nprintf after >after"],
  ["ordinary skipped substitution control", "printf before >before; false && printf '%s' \"$(true |)\"; printf after >after"],
  ["skipped here-string substitution control", "printf before >before; false && cat <<<\"$(true |)\"; printf after >after"],
  ["body diagnostic after earlier newline", "printf before >before\ncat <<EOF\nfirst\n$(true |)\nlast\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["redirected child diagnostic", "printf before >before; cat 2>errors <<EOF\n$(true |)\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["child earlier effect rejected", "printf before >before; cat <<EOF\n$(printf wrong >wrong; true |)\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["malformed backtick body", "printf before >before; cat <<EOF\nhead `true |` tail\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["skipped unterminated substitution", "printf before >before; false && cat <<EOF\n$(true\nEOF\nprintf after >after"],
  ["executed unterminated substitution", "printf before >before; cat <<EOF\n$(true\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["skipped unterminated parameter", "printf before >before; false && cat <<EOF\n${bad\nEOF\nprintf after >after"],
  ["executed unterminated parameter", "printf before >before; cat <<EOF\n${bad\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["earlier body expansion before malformed parameter", "printf before >before; cat <<EOF\n$(printf earlier >inner) ${bad!}\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["backtick child failure keeps later expansions", "printf before >before; cat <<EOF\n`true |` $(printf later >inner; printf good)\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["executed unterminated backtick", "printf before >before; cat <<EOF\nhead `true\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
  ["executed unterminated arithmetic", "printf before >before; cat <<EOF\nhead $((1+2\nEOF\nprintf 'status=%s' \"$?\"; printf after >after"],
];
const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" };
const version = spawnSync(executable, ["--noprofile", "--norc", "--version"], { env: environment, encoding: "utf8", timeout: 2000 }).stdout.split("\n")[0];
const records = cases.map(([name, source]) => {
  const directory = mkdtempSync(join(tmpdir(), "virtual-bash-deferred-heredoc-"));
  try {
    const result = spawnSync(executable, ["--noprofile", "--norc", "-c", source, "shell"], { cwd: directory, env: { ...environment, HOME: directory }, encoding: "utf8", timeout: 2000, maxBuffer: 262144 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return { name, source, stdout: result.stdout, stderr: result.stderr, exitCode: result.status, files: Object.fromEntries(readdirSync(directory).map((name) => [name, readFileSync(join(directory, name), "utf8")])) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
const evidence = { executable, version, executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), argv0: "shell", environment, records };
process.stdout.write(`*** Begin Patch\n*** Add File: tests/shell/deferred-heredoc-reference.json\n${JSON.stringify(evidence, null, 2).split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch\n`);
