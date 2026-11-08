import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { cases as closureCases } from "./cases.js";
import { cases as legacyCases } from "../invocation-modes/cases.js";
import { boundedProcess, fixtureBytes, head, owned, quote, save, sha256 } from "./support.js";

const legacy = process.argv.includes("--legacy");
if (legacy) await readFile("/tmp/safe-bash-shell-invocation-closure-ready.txt");
const name = process.argv[2] ?? "native-preparation.json";
const profiles = [
  { id: "gnu-5.3", executable: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash", expectedHash: "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c" },
  { id: "historical-3.2", executable: "/bin/bash", expectedHash: "35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3" },
];
const captures = [];
for (const profile of profiles) {
  assert.equal(sha256(await readFile(profile.executable)), profile.expectedHash);
  const versions = [];
  for (const argv0 of ["bash", "sh"]) {
    const version = await boundedProcess(profile.executable, ["--noprofile", "--norc", "-c", 'printf "%s\\n" "$BASH_VERSION"; set -o'], { cwd: process.cwd(), argv0, env: { PATH: "unused", HOME: "/nonexistent", LC_ALL: "C", LANG: "C", TZ: "UTC" } });
    assert.equal(version.code, 0);
    assert.match(version.stdout, argv0 === "sh" ? /posix\s+on/u : /posix\s+off/u);
    versions.push(version);
  }
  const rows = [];
  const definitions = legacy ? legacyCases : closureCases;
  for (const definition of definitions) {
    const row = definition as typeof closureCases[number];
    const temporary = await mkdtemp(resolve(owned, ".native-"));
    const renderedFixtures = [];
    try {
      await mkdir(`${temporary}/${legacy ? "base" : ".roles"}`);
      for (const role of ["bash", "sh"]) await symlink(profile.executable, `${temporary}/${legacy ? "base" : ".roles"}/${role}`);
      if (legacy) await symlink("/bin/cat", `${temporary}/base/cat`);
      for (const fixture of row.fixtures ?? []) {
        const path = `${temporary}/${fixture.path}`;
        await mkdir(dirname(path), { recursive: true });
        if (fixture.directory) await mkdir(path, { recursive: true });
        else if (fixture.link) await symlink(fixture.link, path);
        else {
          const bytes = fixtureBytes(fixture, profile.executable);
          await writeFile(path, bytes, { mode: fixture.mode ?? 0o644 });
          renderedFixtures.push({ path: fixture.path, hex: bytes.toString("hex"), sha256: sha256(bytes), mode: fixture.mode ?? 0o644 });
        }
      }
      for (const fixture of row.fixtures ?? []) if (fixture.directory && fixture.mode !== undefined) await chmod(`${temporary}/${fixture.path}`, fixture.mode);
      let source = row.source.replaceAll("{{bash}}", ".roles/bash").replaceAll("{{sh}}", ".roles/sh");
      const role = legacy ? "bash" : row.role ?? "bash";
      let input = row.stdinHex === undefined ? Buffer.from(row.stdin ?? "") : Buffer.from(row.stdinHex, "hex");
      let args = ["-c", source, role];
      if (legacy) {
        source = `bash() { ( exec -a bash ${quote(profile.executable)} --noprofile --norc "$@" ); }; sh() { ( exec -a sh ${quote(profile.executable)} --noprofile --norc "$@" ); };\n${row.source}`;
        args = ["-c", source, "outer"];
      } else if (row.entry === "stdin") { args = ["-s"]; input = Buffer.from(source); }
      else if (row.entry === "file") {
        args = ["entry.sh"];
        await writeFile(`${temporary}/entry.sh`, source);
        renderedFixtures.push({ path: "entry.sh", hex: Buffer.from(source).toString("hex"), sha256: sha256(source), mode: 0o644 });
      }
      const locale = legacy ? "C" : row.locale ?? "C";
      const result = await boundedProcess(profile.executable, ["--noprofile", "--norc", ...args], { cwd: temporary, argv0: role,
        env: { PATH: legacy ? "base" : "unused", HOME: "/nonexistent", LC_ALL: locale, LANG: locale, TZ: "UTC" }, input });
      const effects: Record<string, string> = {};
      for (const path of ["effect", "fd-output"]) {
        try { effects[path] = (await readFile(`${temporary}/${path}`)).toString("hex"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      rows.push({ id: row.id, source, sourceHash: sha256(source), inputHex: input.toString("hex"), renderedFixtures, result, effects });
      console.log(`${profile.id} ${row.id}: ${result.code}${result.timedOut ? " TIMEOUT" : ""}`);
    } finally {
      for (const fixture of row.fixtures ?? []) if (fixture.directory) await chmod(`${temporary}/${fixture.path}`, 0o755).catch(() => {});
      await rm(temporary, { recursive: true, force: true });
    }
  }
  captures.push({ ...profile, versions, rows });
}
await save(name, { timestamp: new Date().toISOString(), head: head(), cohort: legacy ? "unchanged original 57" : "new closure 26",
  cohortHash: sha256(await readFile(legacy ? "tests/shell-stress/invocation-modes/cases.ts" : `${owned}/cases.ts`)),
  profileMapping: "Same complete cohort per profile; direct top-level argv0 bash/sh. New nested {{bash}}/{{sh}} tokens render to .roles/profile symlinks; virtual aliases use bash/sh. Legacy source adapter matches the original capture functions. Shebang {{bash}} renders to the actual profile executable, not host /bin/bash; rendered bytes/args are recorded, not claimed identical.",
  definitions: legacy ? legacyCases : closureCases, profiles: captures });
