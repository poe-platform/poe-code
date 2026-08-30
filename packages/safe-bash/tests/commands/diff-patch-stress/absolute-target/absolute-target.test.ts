import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { diffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { EngineSession } from "../../../../benchmarks/session.js";
import { pluginFixtures } from "../../../../benchmarks/plugin-fixtures.js";

const original = "anchor\nbefore\nend\n";
const revised = "anchor\nafter\nend\n";
const replacement = (oldName = "old", newName = "new") =>
  `--- ${oldName}\n+++ ${newName}\n@@ -1,3 +1,3 @@\n anchor\n-before\n+after\n end\n`;
const creation = "--- /dev/null\n+++ elsewhere\n@@ -0,0 +1,2 @@\n+created\n+entry\n";
const deletion = "--- elsewhere\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-anchor\n-before\n-end\n";
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

interface Entry {
  type: string;
  mode: number;
  nlink: number;
  value?: string;
}

async function snapshot(fs: MemoryFileSystem): Promise<Record<string, Entry>> {
  const entries: Record<string, Entry> = {};
  const visit = async (path: string): Promise<void> => {
    const stat = await fs.lstat(path);
    entries[path] = {
      type: stat.type, mode: stat.mode, nlink: stat.nlink ?? 1,
      ...(stat.type === "file" ? { value: Buffer.from(await fs.readFile(path)).toString("base64") }
        : stat.type === "symlink" ? { value: await fs.readlink(path) } : {}),
    };
    if (stat.type === "directory") {
      for (const entry of await fs.readdir(path)) await visit(`${path === "/" ? "" : path}/${entry.name}`);
    }
  };
  await visit("/");
  return entries;
}

interface Vector {
  name: string;
  args: string[];
  input?: string;
  setup?: (fs: MemoryFileSystem) => Promise<void>;
  error?: RegExp;
  change?: { path: string; value: string | null };
  checking?: boolean;
}

const vectors: Vector[] = [
  { name: "absolute target with relative headers", args: ["/fixture/old"], change: { path: "/fixture/old", value: revised } },
  { name: "absolute target outside cwd remains inside VFS", args: ["/authorized/target"], change: { path: "/authorized/target", value: revised } },
  { name: "relative explicit target overrides existing absolute headers", args: ["old"], input: replacement("/authorized/target", "/authorized/other"), change: { path: "/fixture/old", value: revised } },
  { name: "absolute target overrides different absolute headers", args: ["/authorized/target"], input: replacement("/fixture/old", "/fixture/new"), change: { path: "/authorized/target", value: revised } },
  { name: "large strip cannot remove absolute explicit target", args: ["-p999", "/authorized/target"], change: { path: "/authorized/target", value: revised } },
  { name: "large strip cannot remove relative target or reject ignored absolute headers", args: ["-p999", "old"], input: replacement("/authorized/target", "/authorized/other"), change: { path: "/fixture/old", value: revised } },
  { name: "no target still rejects absolute headers", args: [], input: replacement("/fixture/old", "/fixture/new"), error: /unsafe patch path/u },
  { name: "no target cannot strip away an absolute new header", args: ["-p1"], input: replacement("prefix/old", "/fixture/new"), error: /unsafe patch path/u },
  { name: "traversal in stripped prefix is rejected without target", args: ["-p2"], input: replacement("../prefix/old", "../prefix/old"), error: /unsafe patch path/u },
  { name: "ignored new header traversal is rejected before stripping", args: ["-p999", "/authorized/target"], input: replacement("old", "/ignored/../new"), error: /unsafe patch path/u },
  { name: "explicit target traversal is rejected before normalization", args: ["/authorized/../fixture/old"], error: /unsafe patch path/u },
  { name: "ignored quoted control metadata remains rejected", args: ["/authorized/target"], input: replacement('"old\\033name"', "new"), error: /unsafe patch path/u },
  { name: "explicit final symlink is rejected", args: ["/authorized/link"], setup: fs => fs.symlink("target", "/authorized/link"), error: /symlink/u },
  { name: "explicit ancestor symlink is rejected", args: ["/alias/target"], setup: fs => fs.symlink("/authorized", "/alias"), error: /symlink/u },
  { name: "dangling final symlink cannot become creation target", args: ["/authorized/link"], input: creation, setup: fs => fs.symlink("missing", "/authorized/link"), error: /symlink/u },
  { name: "explicit hardlinked target is rejected without changing either name", args: ["/authorized/target"], setup: fs => fs.link("/authorized/target", "/fixture/alias"), error: /hard-linked/u },
  { name: "absolute virtual input file outside cwd is read without mutation", args: ["-i", "/inputs/change", "/authorized/target"], input: "not a patch", setup: fs => fs.writeFile("/inputs/change", Buffer.from(replacement())), change: { path: "/authorized/target", value: revised } },
  { name: "absolute virtual input symlink is rejected", args: ["-i", "/inputs/link", "/authorized/target"], setup: async fs => { await fs.writeFile("/inputs/change", Buffer.from(replacement())); await fs.symlink("change", "/inputs/link"); }, error: /symlink/u },
  { name: "dry-run explicit target validates without mutation", args: ["--dry-run", "/authorized/target"], checking: true },
  { name: "reverse explicit target ignores header selection", args: ["-R", "/authorized/target"], setup: fs => fs.writeFile("/authorized/target", Buffer.from(revised)), change: { path: "/authorized/target", value: original } },
  { name: "create explicit absolute target ignores creation header", args: ["/authorized/created"], input: creation, change: { path: "/authorized/created", value: "created\nentry\n" } },
  { name: "delete explicit absolute target ignores deletion header", args: ["/authorized/target"], input: deletion, change: { path: "/authorized/target", value: null } },
  { name: "reverse creation deletes only explicit target", args: ["-R", "/authorized/target"], input: creation, setup: fs => fs.writeFile("/authorized/target", Buffer.from("created\nentry\n")), change: { path: "/authorized/target", value: null } },
  { name: "reverse deletion creates only explicit target", args: ["-R", "/authorized/created"], input: deletion, change: { path: "/authorized/created", value: original } },
  { name: "dry-run creation leaves target absent", args: ["--dry-run", "/authorized/created"], input: creation, checking: true },
  { name: "dry-run deletion leaves target present", args: ["--dry-run", "/authorized/target"], input: deletion, checking: true },
  { name: "ignored symlink header paths are not selected or inspected", args: ["/authorized/target"], input: replacement("/ignored/link", "/ignored/link"), setup: async fs => { await fs.mkdir("/ignored"); await fs.symlink("/fixture/old", "/ignored/link"); }, change: { path: "/authorized/target", value: revised } },
];

for (const vector of vectors) {
  test(vector.name, { timeout: 5000 }, async () => {
    const fs = new MemoryFileSystem();
    for (const path of ["/fixture", "/authorized", "/inputs"]) await fs.mkdir(path);
    for (const path of ["/fixture/old", "/fixture/new", "/authorized/target", "/authorized/other"]) await fs.writeFile(path, Buffer.from(original));
    await fs.writeFile("/sentinel", Buffer.from([0, 255, 10, 128]));
    await vector.setup?.(fs);
    const before = await snapshot(fs);
    const shell = new Shell({ fs, cwd: "/fixture", env: {}, limits: { maxOutputBytes: 8192, maxCommands: 8 } });
    shell.use(diffPatchCommands());
    try {
      const result = await shell.exec(`patch ${vector.args.map(quote).join(" ")}`, { stdin: Buffer.from(vector.input ?? replacement()) });
      const stdout = Buffer.from(result.stdoutBytes).toString("utf8");
      const stderr = Buffer.from(result.stderrBytes).toString("utf8");
      if (vector.error) {
        assert.equal(result.exitCode, 2, stderr);
        assert.equal(stdout, "");
        assert.match(stderr, vector.error);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const target = vector.args.at(-1)!;
        assert.equal(stdout, `${vector.checking ? "checking" : "patching"} file ${target}\n`);
      }
      const expected = structuredClone(before);
      if (vector.change) {
        const { path, value } = vector.change;
        if (value === null) delete expected[path];
        else expected[path] = { ...(before[path] ?? { type: "file", mode: 0o100666, nlink: 1 }), value: Buffer.from(value).toString("base64") };
      }
      assert.deepEqual(await snapshot(fs), expected, "entire VFS: only the authorized target may change");
    } finally { await shell.dispose(); }
  });
}

test("exact benchmark fixture through existing EngineSession and pluginFixtures", { timeout: 20000 }, async context => {
  const fixture = pluginFixtures().find(item => item.name === "plugin-diff-patch-roundtrip");
  assert(fixture);
  assert.equal(fixture.script, "diff -u --label old --label new old new > change; patch /fixture/old < change; cat old");
  assert.equal(Buffer.from(fixture.expected.stdout, "base64").toString(), "patching file /fixture/old\na\nc\n");
  for (const engine of ["virtual-bash", "just-bash"] as const) {
    const session = new EngineSession(engine);
    try {
      const result = await session.run({ kind: "fixture", fixture });
      context.diagnostic(JSON.stringify(result));
      assert.deepEqual(session.backgroundErrors, []);
      if (engine === "virtual-bash") {
        assert.equal(result.status, "pass", JSON.stringify(result));
        assert.deepEqual(result.assertions.map(item => [item.name, item.status]), [
          ["stdout.bytes", "pass"], ["stderr.bytes", "pass"], ["exitCode", "pass"],
          ["filesystem.complete-regular-file-snapshot", "pass"],
        ]);
      }
    } finally { await session.dispose(); }
  }
});
