import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("./", import.meta.url));
const destination = `${directory}native.json`;
const executable = "/usr/bin/jq";
const hash = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const cases: { id: string; argv: string[]; input: string; direct?: { input: unknown; separator: unknown } }[] = [];
const direct = (id: string, input: unknown, separator: unknown): void => {
  cases.push({ id, argv: ["-c", `split(${JSON.stringify(separator)})`], input: `${JSON.stringify(input)}\n`, direct: { input, separator } });
};
for (const [id, input, separator] of [
  ["lines", "alpha\nbeta\n", "\n"],
  ["empty-input", "", ","], ["empty-both", "", ""], ["empty-separator", "abc", ""],
  ["no-match", "abc", ","], ["entire-match", "abc", "abc"], ["longer-separator", "a", "abc"],
  ["leading", ",a", ","], ["trailing", "a,", ","], ["repeated", ",a,,b,", ","],
  ["all-separators", ",,,", ","], ["multichar", "a::b::::c::", "::"],
  ["overlap", "ababa", "aba"], ["overlap-repeat", "aaaaa", "aa"],
  ["literal-dot", "a.b.c", "."], ["literal-pattern", "a.*b.*c", ".*"],
  ["literal-bracket", "a[b[", "["], ["literal-backslash", "a\\b\\", "\\"],
  ["literal-anchor", "a^b^", "^"], ["literal-alternative", "a|b|", "|"],
  ["astral-empty-separator", "A😀𝄞Z", ""], ["multibyte-empty-separator", "é中α", ""],
  ["combining-not-graphemes", "e\u0301👨‍👩‍👧", ""], ["astral-separator", "😀a😀😀b😀", "😀"],
  ["multibyte-separator", "前中後中", "中"], ["no-normalization", "é-e\u0301", "é"],
  ["nul-separator", "a\0b\0", "\0"], ["nul-input", "a\0b", ""],
  ["nul-multichar", "a\0xb\0x", "\0x"], ["nul-only", "\0", "\0"],
  ["crlf", "a\r\nb\r\n", "\r\n"], ["controls", "\t\n\r\b\f\u0001", ""],
] as const) direct(id, input, separator);
for (const [index, value] of [null, false, true, 0, 1.5, [], ["a"], {}, { a: 1 }].entries()) {
  direct(`invalid-input-${index}`, value, ",");
  direct(`invalid-separator-${index}`, "a,b", value);
}
direct("both-invalid", null, 1);
for (const [id, filter, input] of [
  ["separator-generator", 'split((",", ";"))', '"a,b;c"\n'],
  ["separator-input-context", 'split(.)', '"abc"\n'],
  ["separator-empty-generator", "split(empty)", "null\n"],
  ["generator-valid-then-invalid", 'split((",", 1, ";"))', '"a,b;c"\n'],
  ["generator-invalid-first", 'split((1, ","))', '"a,b"\n'],
  ["generator-error-after-output", 'split((",", .missing))', '"a,b"\n'],
  ["generator-error-before-typecheck", "split(.missing)", "1\n"],
  ["input-generator", '(.[] | split(","))', '["a,b","c,d"]\n'],
  ["input-generator-error-order", '(.[] | split(","))', '["a,b",1,"c,d"]\n'],
  ["optional-error-resume", 'split((",", 1, ";"))?', '"a,b;c"\n'],
  ["optional-type-error", 'split(",")?', "null\n"],
  ["first-stops-generator-error", 'first(split((",", 1)))', '"a,b"\n'],
  ["limit-stops-generator-error", 'limit(1; split((",", 1)))', '"a,b"\n'],
  ["collection-discards-partial-on-error", '[split((",", 1))]', '"a,b"\n'],
  ["generator-cartesian-order", '(.[] | split((",", ";")))', '["a,b;c","d,e;f"]\n'],
] as const) cases.push({ id, argv: ["-c", filter], input });
cases.push({ id: "matrix-raw-lines", argv: ["-R", "-s", 'split("\\n") | map(select(length > 0))'], input: "alpha\nbeta\n" });
cases.push({ id: "raw-empty", argv: ["-R", "-s", "-c", 'split("\\n")'], input: "" });
cases.push({ id: "raw-nul-output", argv: ["-R", "-s", "-r", 'split(",")[]'], input: "a\0b,c\0" });

const temporary = mkdtempSync(`${directory}.native-`);
try {
  const invoke = (argv: readonly string[], input = "") => {
    const result = spawnSync(executable, argv, {
      cwd: temporary, input: Buffer.from(input), shell: false,
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", HOME: temporary, NO_COLOR: "1" },
      timeout: 2000, killSignal: "SIGKILL", maxBuffer: 64 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, null);
    const stdout = result.stdout.toString("utf8");
    const stderr = result.stderr.toString("utf8");
    assert.deepEqual(Buffer.from(stdout), result.stdout);
    assert.deepEqual(Buffer.from(stderr), result.stderr);
    return { status: result.status!, stdout, stderr, stdoutSha256: hash(result.stdout), stderrSha256: hash(result.stderr) };
  };
  const evidence = {
    schema: 1, capturedAt: new Date().toISOString(), executable,
    executableSha256: hash(readFileSync(executable)), version: invoke(["--version"]).stdout.trim(),
    platform: process.platform, architecture: process.arch, node: process.version,
    policy: "Native exact stdout/stderr UTF-8 bytes and exit status captured before split helper implementation; never regenerate to fit virtual behavior.",
    caps: { timeoutMs: 2000, maxBufferBytes: 65536, shell: false },
    cases: cases.map(fixture => ({ ...fixture, ...invoke(fixture.argv, fixture.input) })),
  };
  if (process.argv.includes("--freeze")) {
    assert.equal(existsSync(destination), false, "frozen evidence must not be overwritten");
    const text = `${JSON.stringify(evidence, null, 2)}\n`;
    const patch = `*** Begin Patch\n*** Add File: ${destination}\n${text.split("\n").slice(0, -1).map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
    const result = spawnSync("apply_patch", [patch], { shell: false, encoding: "utf8", timeout: 5000, maxBuffer: 65536 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    console.log(result.stdout.trim());
    console.log(JSON.stringify({ cases: evidence.cases.length, version: evidence.version, sha256: hash(text), statuses: evidence.cases.map(row => [row.id, row.status]) }, null, 2));
  } else {
    const frozen = JSON.parse(readFileSync(destination, "utf8")) as typeof evidence;
    assert.equal(evidence.executableSha256, frozen.executableSha256, "native binary changed; do not overwrite provenance");
    assert.deepEqual(evidence.cases, frozen.cases);
    console.log(`Native exact-byte recapture: ${evidence.cases.length}/${frozen.cases.length}; frozen SHA-256 ${hash(readFileSync(destination))}`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
