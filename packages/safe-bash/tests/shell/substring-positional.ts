import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bounded, hash, profiles, sourceHashes } from "./invocation-closure-native.js";
import { virtualSubstring } from "./substring-native.js";
import type { SubstringObservation } from "./substring-native.js";

export const positionalSubstringCases = [
  { name: "leading-zero-name", source: 'printf "<%s>" "${00:1:2}"' },
  { name: "leading-zero-one", source: 'set -- abcdef; printf "<%s>" "${01:1:2}"' },
  { name: "leading-zero-ten", source: 'set -- a b c d e f g h i abcdef; printf "<%s>" "${010:1:2}"' },
  { name: "leading-zero-missing", source: 'printf "<%s>" "${099:1:2}"' },
];
export interface PositionalSubstringReference { profiles: { name: string; rows: { name: string; expected: SubstringObservation }[] }[] }
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const reference = { source: await sourceHashes(), locale: "C", argv0: "bash", commandName: "shell", caseHash: hash(JSON.stringify(positionalSubstringCases)), profiles: [] as { name: string; executable: string; sha256: string; rows: { name: string; expected: SubstringObservation }[] }[], before: [] as { name: string; actual: SubstringObservation }[] };
  for (const profile of profiles) {
    const rows: { name: string; expected: SubstringObservation }[] = [];
    const cwd = await mkdtemp("/tmp/safe-bash-substring-positional-");
    try { for (const fixture of positionalSubstringCases) {
      const result = await bounded(profile.executable, ["--noprofile", "--norc", "-c", fixture.source, "shell"], cwd, "bash", "C");
      rows.push({ name: fixture.name, expected: { stdout: result.stdout.toString("base64"), stderr: result.stderr.toString("base64"), status: result.status, files: {} } });
    } } finally { await rm(cwd, { recursive: true, force: true }); }
    reference.profiles.push({ ...profile, sha256: hash(await readFile(profile.executable)), rows });
  }
  for (const fixture of positionalSubstringCases) reference.before.push({ name: fixture.name, actual: await virtualSubstring(fixture, "C") });
  assert.deepEqual(await sourceHashes(), reference.source);
  console.log(JSON.stringify(reference, null, 2));
}
