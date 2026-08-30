import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { treeCommands } from "../../../src/commands/tree/index.js";
import { type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { S3FileSystem, MockS3Client } from "../../../src/fs/s3/index.js";
import { Shell } from "../../../src/shell/index.js";
import { quote, seed, shellRun } from "./helpers.js";

for (const backend of ["memory", "real", "readonly", "mount", "overlay", "mock-s3"] as const) {
  test(`actual Shell common traversal on ${backend} (no deployed-provider claim)`, async context => {
    const expected = createMemoryFileSystem(); await seed(expected, false);
    let fs: FileSystem = createMemoryFileSystem(), cwd = "/";
    if (backend === "real") {
      const root = await mkdtemp(join(tmpdir(), "safe-bash-tree-real-"));
      context.after(() => rm(root, { recursive: true, force: true }));
      fs = await createRealFileSystem({ root });
    } else if (backend === "mock-s3") {
      fs = new S3FileSystem({ transport: new MockS3Client({ buckets: ["tree"], pageSize: 2 }), bucket: "tree", pageSize: 2 });
    }
    await seed(fs, false);
    if (backend === "readonly") fs = createReadOnlyFileSystem(fs);
    if (backend === "mount") { fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/data": fs } }); cwd = "/data"; }
    if (backend === "overlay") fs = createOverlayFileSystem({ lower: fs, upper: createMemoryFileSystem() });
    const shell = new Shell({ fs, cwd }).use(treeCommands());
    try {
      for (const args of [["-a"], ["-Ji"], ["-d", "-L1"], ["-fi", "-P", "*.txt", "--noreport"]]) {
        const baseline = await shellRun(expected, args);
        const result = await shell.exec(`tree ${args.map(quote).join(" ")}`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, baseline.stdout);
        assert.equal(result.stderr, "");
      }
    } finally { await shell.dispose(); }
  });
}

test("real VFS and mount aliases preserve followed ancestor identity without global deduplication", async context => {
  const root = await mkdtemp(join(tmpdir(), "safe-bash-tree-real-links-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const real = await createRealFileSystem({ root }); await seed(real);
  const memory = createMemoryFileSystem(); await seed(memory);
  for (const args of [[], ["-li"], ["-Jli", "--noreport"]]) {
    assert.equal((await shellRun(real, args)).stdout, (await shellRun(memory, args)).stdout);
  }
  const mounted = createMountFileSystem({ root: memory, mounts: { "/alias": memory } });
  const result = await shellRun(mounted, ["-i", "--noreport"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /alias {2}\[recursive, not followed\]/u);
});
