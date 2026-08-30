import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { capture, virtualObservation } from "./invocation-closure-native.js";
import { sourceCases, evalCases } from "./source-dot-eval-cases.js";
import type { CurrentShellCase } from "./source-dot-eval-cases.js";

export function fixtureCase(fixture: CurrentShellCase) {
  return { ...fixture, files: Object.fromEntries(Object.entries(fixture.files).map(([name, text]) => [name, { text, mode: 0o644 }])) };
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const [action, group, output] = process.argv.slice(2);
  assert.ok(output);
  const cases = (group === "source" ? sourceCases : evalCases).map(fixtureCase);
  if (action === "capture") {
    const result = await capture(cases);
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log(`captured ${cases.length * 2} rows/profile ${group}`);
  } else {
    assert.equal(action, "compare");
    const reference = JSON.parse(await readFile(new URL(`./source-dot-eval-${group}-native.json`, import.meta.url), "utf8")) as Awaited<ReturnType<typeof capture>>;
    const profiles = [];
    for (const profile of reference.profiles) {
      const rows = [];
      for (const entry of profile.observations) {
        const actual = await virtualObservation(cases.find(fixture => fixture.name === entry.name)!, entry.mode, entry.cwd);
        let match = true;
        try { assert.deepEqual(actual, entry.observation); } catch { match = false; }
        rows.push({ name: entry.name, mode: entry.mode, expected: entry.observation, actual, match });
      }
      profiles.push({ name: profile.name, passed: rows.filter(row => row.match).length, total: rows.length, rows });
    }
    await writeFile(output, `${JSON.stringify({ profiles }, null, 2)}\n`, { flag: "wx" });
    console.log(profiles.map(profile => `${profile.name} ${profile.passed}/${profile.total}`).join("; "));
    if (profiles.some(profile => profile.passed !== profile.total)) process.exitCode = 1;
  }
}
