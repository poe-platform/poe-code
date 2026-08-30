import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { command, view } from "./helpers.js";
import { nativeFixtures } from "./native-fixtures.js";

const encoded = readFileSync(new URL("./native-gnu-9.7.json", import.meta.url));
interface Observation {
  name: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  entries: Record<string, { kind: "file" | "symlink"; value: string }>;
}
const evidence = JSON.parse(encoded.toString()) as { observations: Observation[] };

for (const fixture of nativeFixtures) test(`GNU 9.7: ${fixture.name}`, async context => {
  context.diagnostic(`Frozen native evidence SHA256 ${createHash("sha256").update(encoded).digest("hex")}`);
  const expected = evidence.observations.find(row => row.name === fixture.name);
  assert.ok(expected);
  const base = createMemoryFileSystem();
  for (const [name, data] of Object.entries(fixture.files)) await base.writeFile(`/${name}`, Buffer.from(data, "base64"));
  for (const [name, target] of Object.entries(fixture.links ?? {})) await base.symlink(target, `/${name}`);
  for (const [name, target] of Object.entries(fixture.hardlinks ?? {})) await base.link(`/${target}`, `/${name}`);
  const fs = fixture.command === "mv" ? view(base, { rename: async () => { throw new FsError("EXDEV"); } }) : base;
  const actual = await command(fixture.command, fixture.args, fs);
  const entries: Observation["entries"] = {};
  for (const { name } of (await base.readdir("/")).sort((left, right) => left.name.localeCompare(right.name))) {
    const stat = await base.lstat(`/${name}`);
    entries[name] = stat.type === "symlink" ? { kind: "symlink", value: await base.readlink(`/${name}`) }
      : { kind: "file", value: Buffer.from(await base.readFile(`/${name}`)).toString("base64") };
  }
  assert.deepEqual(entries, expected.entries, "resulting bytes and directory entries match the isolated GNU run");
  assert.equal(actual.exitCode, expected.exitCode, `${actual.stderr || "no virtual diagnostic"}; GNU: ${expected.stderr}`);
  assert.equal(actual.stdout, expected.stdout);
  assert.equal(actual.stderr.length === 0, expected.stderr.length === 0);
});
