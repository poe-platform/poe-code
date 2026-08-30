import { chmod, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { cases } from "../invocation-modes/cases.js";
import { boundedProcess, fixtureBytes, head, inputBytes, owned, quote, sanitizedEnv, sha256 } from "../invocation-modes/harness.js";
import { writeFile } from "node:fs/promises";

import { tmpdir } from "node:os";
import { save } from "./support.mjs";

const profiles = [
  { id: "gnu-5.3", executable: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash" },
  { id: "historical-3.2", executable: "/bin/bash" },
];
const results = [];
for (const profile of profiles) {
  const interpreterHash = sha256(await readFile(profile.executable));
  const version = await boundedProcess(profile.executable, ["--noprofile", "--norc", "-c", 'printf "%s\\n" "$BASH_VERSION"; set -o'], {
    cwd: process.cwd(), env: sanitizedEnv(), argv0: "sh",
  });
  if (version.code !== 0 || !version.stdout.includes(profile.id === "gnu-5.3" ? "5.3." : "3.2.") || !/posix\s+on/u.test(version.stdout)) throw new Error(`Incorrect sh provenance ${profile.id}`);
  const rows = [];
  for (const row of cases) {
    const temporary = await mkdtemp(resolve(tmpdir(), "safe-bash-reconcile-invocation-"));
    const renderedFixtures = [];
    try {
      await mkdir(`${temporary}/base`);
      await symlink(profile.executable, `${temporary}/base/bash`);
      await symlink(profile.executable, `${temporary}/base/sh`);
      await symlink("/bin/cat", `${temporary}/base/cat`);
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
      for (const fixture of row.fixtures ?? []) if (fixture.mode !== undefined && fixture.directory) await chmod(`${temporary}/${fixture.path}`, fixture.mode);
      const prelude = `bash() { ( exec -a bash ${quote(profile.executable)} --noprofile --norc "$@" ); }; sh() { ( exec -a sh ${quote(profile.executable)} --noprofile --norc "$@" ); };\n`;
      const source = prelude + row.source;
      const result = await boundedProcess(profile.executable, ["--noprofile", "--norc", "-c", source, "outer"], {
        cwd: temporary, env: sanitizedEnv(), input: inputBytes(row), argv0: "bash",
      });
      const effects: Record<string, string> = {};
      for (const path of ["effect", "fd-output"]) {
        try { effects[path] = (await readFile(`${temporary}/${path}`)).toString("hex"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      rows.push({ id: row.id, source, sourceHash: sha256(source), inputHex: inputBytes(row).toString("hex"), renderedFixtures, result, effects });
      console.log(`${profile.id} ${row.id}: ${result.code}${result.timedOut ? " TIMEOUT" : ""}`);
    } finally {
      for (const fixture of row.fixtures ?? []) if (fixture.directory) await chmod(`${temporary}/${fixture.path}`, 0o755).catch(() => {});
      await rm(temporary, { recursive: true, force: true });
    }
  }
  results.push({ ...profile, interpreterHash, version, rows });
}
save("acceptance-native57-f1bb98b.json", {
  timestamp: new Date().toISOString(), head: head(), cohortHash: sha256(await readFile(`${owned}/cases.ts`)),
  fixtureMapping: "Native bash/sh functions exec the pinned profile with argv0 bash/sh. Nested role names resolve base symlinks to the same profile. Shebang {{bash}} is replaced by the profile executable (virtual /bin/bash); headers are NOT byte-identical. base/cat is native /bin/cat, virtual cat is standardCommands. Native stdin is one pipe write; virtual chunkBytes additionally tests transport partitioning.",
  nativeCatHash: sha256(await readFile("/bin/cat")), cases, profiles: results,
});
