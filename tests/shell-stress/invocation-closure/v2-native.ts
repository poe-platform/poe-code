import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { cases, adaptations } from "./v2-cases.js";
import { boundedProcess, fixtureBytes, head, owned, save, sha256 } from "./support.js";

const original = JSON.parse(await readFile(`${owned}/native-preparation.json`, "utf8")) as { profiles: { id: string; executable: string; expectedHash: string }[] };
const profiles = [];
for (const profile of original.profiles) {
  assert.equal(sha256(await readFile(profile.executable)), profile.expectedHash);
  const versions = [];
  for (const argv0 of ["bash", "sh"]) {
    const result = await boundedProcess(profile.executable, ["--noprofile", "--norc", "-c", 'printf "%s\\n" "$BASH_VERSION"; set -o'], {
      cwd: process.cwd(), argv0, env: { PATH: "unused", HOME: "/nonexistent", LC_ALL: "C", LANG: "C", TZ: "UTC" },
    });
    assert.equal(result.code, 0); assert.match(result.stdout, argv0 === "sh" ? /posix\s+on/u : /posix\s+off/u); versions.push(result);
  }
  const rows = [];
  for (const row of cases) {
    const temporary = await mkdtemp(resolve(owned, ".native-v2-"));
    const renderedFixtures = [];
    try {
      await mkdir(`${temporary}/.roles`);
      for (const role of ["bash", "sh"]) await symlink(profile.executable, `${temporary}/.roles/${role}`);
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
      const source = row.source.replaceAll("{{bash}}", ".roles/bash").replaceAll("{{sh}}", ".roles/sh");
      const role = row.role ?? "bash";
      let args = ["-c", source, role];
      let input = row.stdinHex === undefined ? Buffer.from(row.stdin ?? "") : Buffer.from(row.stdinHex, "hex");
      if (row.entry === "stdin") { args = ["-s"]; input = Buffer.from(source); }
      else if (row.entry === "file") {
        args = ["entry.sh"]; await writeFile(`${temporary}/entry.sh`, source);
        renderedFixtures.push({ path: "entry.sh", hex: Buffer.from(source).toString("hex"), sha256: sha256(source), mode: 0o644 });
      }
      const locale = row.locale ?? "C";
      const result = await boundedProcess(profile.executable, ["--noprofile", "--norc", ...args], { cwd: temporary, argv0: role,
        env: { PATH: "unused", HOME: "/nonexistent", LC_ALL: locale, LANG: locale, TZ: "UTC" }, input });
      rows.push({ id: row.id, source, sourceHash: sha256(source), inputHex: input.toString("hex"), renderedFixtures, result });
      console.log(`${profile.id} ${row.id}: ${result.code}`);
    } finally {
      for (const fixture of row.fixtures ?? []) if (fixture.directory) await chmod(`${temporary}/${fixture.path}`, 0o755).catch(() => {});
      await rm(temporary, { recursive: true, force: true });
    }
  }
  profiles.push({ ...profile, versions, rows });
}
await save(process.argv[2] ?? "v2-native.json", { timestamp: new Date().toISOString(), head: head(), cohort: "v2 complete 26, only queried builtin operands changed", cohortHash: sha256(JSON.stringify(cases)), originalCasesHash: sha256(await readFile(`${owned}/cases.ts`)), v2CasesHash: sha256(await readFile(`${owned}/v2-cases.ts`)), adaptations, definitions: cases, profiles,
  mapping: "All 26 rows in both profiles. Same roles/locales/source templates; actual argv0 bash/sh and nested role symlinks point to the captured profile executable. Shebangs render to that executable; headers are not byte-identical across profiles. No diagnostic/label normalization or per-case oracle." });
assert.ok(profiles.every(profile => profile.rows.every(row => !row.result.timedOut && !row.result.overflow)));
