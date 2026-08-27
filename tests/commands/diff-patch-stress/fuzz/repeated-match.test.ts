import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Shell } from "../../../../src/shell/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { diffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { repeatedMatchFixtures } from "./repeated-match-fixtures.js";

interface Entry { readonly type: string; readonly mode: number; readonly nlink: number; readonly hex?: string }
interface NativeResult { readonly profile: string; readonly status: number; readonly stdout: string; readonly stderr: string; readonly after: Record<string, Entry> }
const evidence = JSON.parse(readFileSync(new URL("../evidence/fullgate-51282a9-followup/before-expanded.json", import.meta.url), "utf8")) as {
  rows: { fixture: typeof repeatedMatchFixtures[number]; natives: NativeResult[] }[];
};

async function namespace(filesystem: MemoryFileSystem): Promise<Record<string, Entry>> {
  const entries: Record<string, Entry> = {};
  async function walk(path: string): Promise<void> {
    const stat = await filesystem.lstat(path);
    entries[path] = { type: stat.type, mode: stat.mode, nlink: stat.nlink!,
      ...(stat.type === "file" ? { hex: Buffer.from(await filesystem.readFile(path)).toString("hex") } : {}) };
    if (stat.type === "directory") for (const entry of await filesystem.readdir(path)) await walk(`${path === "/" ? "" : path}/${entry.name}`);
  }
  await walk("/");
  return entries;
}

for (const fixture of repeatedMatchFixtures) for (const atomic of [false, true]) {
  test(`signed hunk search: ${fixture.name}/${atomic ? "atomic" : "ordinary"}`, async () => {
    const row = evidence.rows.find(row => row.fixture.name === fixture.name)!;
    assert.deepEqual(fixture, row.fixture);
    const native = row.natives.find(result => result.profile === "gnu")!;
    const filesystem = new MemoryFileSystem();
    await filesystem.mkdir("/work");
    await filesystem.writeFile("/work/first", Buffer.from("keep\n"));
    await filesystem.writeFile("/work/target", Buffer.from(fixture.target));
    const before = await namespace(filesystem);
    const shell = new Shell({ fs: filesystem, cwd: "/work" }).use(diffPatchCommands());
    const result = await shell.exec(atomic ? "patch --atomic" : "patch", { stdin: fixture.input });
    assert.equal(result.exitCode, native.status);
    if (atomic && native.status !== 0) {
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "patch: hunk 2 does not match target\n");
      assert.deepEqual(await namespace(filesystem), before);
    } else {
      assert.equal(result.stdout, native.stdout);
      assert.equal(result.stderr, native.stderr);
      assert.deepEqual(await namespace(filesystem), Object.fromEntries(Object.entries(native.after).map(([path, entry]) => [path,
        { type: entry.type, mode: (before[path] ?? before["/work/target"]!).mode,
          nlink: (before[path] ?? before["/work/target"]!).nlink, ...(entry.hex === undefined ? {} : { hex: entry.hex }) }])));
    }
  });
}
