import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { boundedProcess, owned, save, sha256 } from "./support.js";

const path = "tests/shell-stress/script-entrypoint/cases.ts";
const originalFile = execFileSync("git", ["show", `480be8c:${path}`], { encoding: "utf8" });
const originalDefinition = / {2}async "builtin-function-registry-shadow"\(\) \{[\s\S]*?\n {2}\},/u.exec(originalFile)![0];
const sources = [
  { id: "original", source: 'true() { say unexpected-function; }; true; args "$?"; bash; args "$?"; bash() { status 13; }; bash; args "$?"; ./shadow', expected: 'unexpected-function\n["0"]["12"]["13"]["12"]' },
  { id: "strengthened", source: 'true() { say function-true; status 7; }; true; args "$?"; command true; args "$?"; bash; args "$?"; bash() { status 13; }; bash; args "$?"; command bash; args "$?"; ./shadow', expected: 'function-true\n["7"]["0"]["12"]["13"]["12"]["12"]' },
];
const helpers = 'say() { printf "%s\\n" "$*"; }; args() { printf \'["%s"]\' "$1"; }; status() { return "$1"; }; export -f args;\n';
const reference = JSON.parse(await readFile(`${owned}/native-preparation.json`, "utf8")) as { profiles: { id: string; executable: string; expectedHash: string }[] };
const profiles = [];
for (const profile of reference.profiles) {
  assert.equal(sha256(await readFile(profile.executable)), profile.expectedHash);
  const rows = [];
  for (const row of sources) {
    const temporary = await mkdtemp(resolve(owned, ".native-"));
    try {
      await mkdir(`${temporary}/tools`);
      const fixtures = { "tools/true": `#!${profile.executable}\nexit 91\n`, "tools/bash": `#!${profile.executable}\nexit 12\n`, shadow: `#!${profile.executable}\nbash; args "$?"\n` };
      for (const [name, body] of Object.entries(fixtures)) await writeFile(`${temporary}/${name}`, body, { mode: 0o755 });
      const result = await boundedProcess(profile.executable, ["--noprofile", "--norc", "-c", helpers + row.source, "bash"], {
        cwd: temporary, argv0: "bash", env: { PATH: "tools", HOME: "/nonexistent", LC_ALL: "C", LANG: "C", TZ: "UTC" },
      });
      rows.push({ ...row, renderedSource: helpers + row.source, fixtures: Object.entries(fixtures).map(([name, body]) => ({ name, mode: 0o755, hex: Buffer.from(body).toString("hex"), sha256: sha256(body) })), result });
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  profiles.push({ ...profile, rows });
}
await save("precedence-native.json", {
  timestamp: new Date().toISOString(), path, originalFileHash: sha256(originalFile), originalDefinition,
  otherDefinitionsHash: sha256(originalFile.replace(originalDefinition, "AUTHORIZED CASE")),
  oldExpected: '["0"]["12"]["13"]["12"]', sources, profiles,
  primaryManuals: ["https://www.gnu.org/software/bash/manual/html_node/Command-Search-and-Execution.html", "https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html"],
  nativeSource: { path: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/bash-5.3/execute_cmd.c", sha256: sha256(await readFile("/tmp/safe-bash-gnu-bash-5.3.Ua5t02/bash-5.3/execute_cmd.c")) },
  adaptation: "Native executable true/bash fixtures model the virtual registry fallback, not native registry support. args/say/status helpers model only literal status rendering; exported args is inherited by the actual profile-shebang child. Same two sources for both profiles, no output normalization. Virtual registry precedence additionally remains asserted by seen[].",
});
for (const profile of profiles) for (const row of profile.rows) {
  assert.equal(row.result.timedOut, false); assert.equal(row.result.overflow, false);
  assert.equal(row.result.code, 0); assert.equal(row.result.stderrHex, "");
  assert.equal(row.result.stdout, row.expected);
}
console.log("Both original and strengthened precedence sources match both actual profiles (4/4); old expected stdout is obsolete.");
