import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const temporary = await mkdtemp(join(root, "tests/fs/mount/.identity-mutation-"));
const sources = [...["memory", "real", "mount", "readonly", "overlay"].map((name) => `src/fs/${name}/index.ts`), "src/fs/mount/identity.ts", "src/fs/mount/comparison.ts", "src/fs/s3/authority.ts", "src/fs/webdav/resource-id.ts"];
const originals = new Map(await Promise.all(sources.map(async (path) => [path, await readFile(join(root, path), "utf8")] as const)));
const hashes = Object.fromEntries([...originals].map(([path, text]) => [path, createHash("sha256").update(text).digest("hex")]));
const results: { name: string; exit: number | null; killed: boolean; stdout: string; stderr: string }[] = [];

try {
  for (const path of ["src", "package.json", "tests/fs/real/helpers.ts", "tests/fs/memory/comparison.test.ts", "tests/fs/webdav/mock.ts",
    "tests/fs/real/copy-identity.test.ts", "tests/fs/mount/copy-identity.test.ts", "tests/fs/mount/copy-identity-guards.test.ts",
    "tests/fs/overlay/helpers.ts", "tests/fs/overlay/copy-identity.test.ts", "tests/fs/mount/identity-scope.test.ts"]) {
    await mkdir(dirname(join(temporary, path)), { recursive: true });
    await cp(join(root, path), join(temporary, path), { recursive: true });
  }
  const mutations = [
    {
      name: "mount scoped alias guard removed",
      path: "src/fs/mount/index.ts",
      before: '      let identity = compareIdentity(origin.stat, target.stat);\n      if (identity === "same") fail("EINVAL");',
      after: '      let identity = compareIdentity(origin.stat, target.stat);',
      tests: ["tests/fs/mount/copy-identity.test.ts", "tests/fs/mount/copy-identity-guards.test.ts"],
    },
    {
      name: "mount unknown identity guard removed",
      path: "src/fs/mount/index.ts",
      before: '      if (target.stat && identity === "unknown") fail("ENOTSUP");',
      after: "",
      tests: ["tests/fs/mount/copy-identity-guards.test.ts"],
      pattern: "unknown .* identity rejects",
    },
    {
      name: "overlay scoped alias guard removed",
      path: "src/fs/overlay/index.ts",
      before: '        if (identity === "same") fail("EINVAL", destination, "source and destination are the same file");\n        if (identity === "unknown") fail("ENOTSUP", destination, "backing-entry identity is unknown");',
      after: '        if (identity === "unknown") fail("ENOTSUP", destination, "backing-entry identity is unknown");',
      tests: ["tests/fs/overlay/copy-identity.test.ts"],
    },
    {
      name: "identity scopes ignored and colliding coordinates equated",
      path: "src/fs/mount/identity.ts",
      before: 'left.identityScope === right.identityScope && left.dev === right.dev && left.ino === right.ino',
      after: 'left.dev === right.dev && left.ino === right.ino',
      tests: ["tests/fs/mount/copy-identity.test.ts", "tests/fs/overlay/copy-identity.test.ts", "tests/fs/mount/identity-scope.test.ts"],
    },
    {
      name: "native same-file guard removed",
      path: "src/fs/real/index.ts",
      before: '      if (target && origin.isFile() && origin.dev === target.dev && origin.ino === target.ino) throw new FsError("EINVAL");',
      after: "",
      tests: ["tests/fs/real/copy-identity.test.ts"],
    },
    {
      name: "missing cross-mount destination no longer exclusive",
      path: "src/fs/mount/index.ts",
      before: '...options, flag: options.exclusive || !target.stat ? "wx" : "w",',
      after: '...options, flag: options.exclusive ? "wx" : "w",',
      tests: ["tests/fs/mount/copy-identity-guards.test.ts"],
      pattern: "destination races from missing",
    },
    {
      name: "Memory identity survives changed data operation mapping",
      path: "src/fs/memory/index.ts",
      before: '...(ownedStores.get(this)?.intact() ? { identityScope: this.identityScope } : {})',
      after: 'identityScope: this.identityScope',
      tests: ["tests/fs/memory/comparison.test.ts"],
      pattern: "Memory .*data overrides",
    },
    {
      name: "Memory accepts unqualified remote descriptors",
      path: "src/fs/memory/index.ts",
      before: 'const qualified = getOwnedS3Entry(peer) ?? getOwnedWebDavEntry(peer);',
      after: 'const qualified = true;',
      tests: ["tests/fs/memory/comparison.test.ts"],
      pattern: "genuine .*metadata with Memory-alias content mapping",
    },
  ];
  for (const mutation of mutations) {
    const original = originals.get(mutation.path)!;
    assert.equal(original.split(mutation.before).length, 2, `unique mutation anchor: ${mutation.name}`);
    await writeFile(join(temporary, mutation.path), original.replace(mutation.before, mutation.after));
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test",
      ...("pattern" in mutation ? ["--test-name-pattern", mutation.pattern] : []), ...mutation.tests],
    { cwd: temporary, encoding: "utf8", timeout: 30_000 });
    const killed = result.status === 1 && /not ok/.test(result.stdout) && /ERR_ASSERTION/.test(result.stdout);
    results.push({ name: mutation.name, exit: result.status, killed, stdout: result.stdout, stderr: result.stderr });
    await writeFile(join(temporary, mutation.path), original);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
  for (const [path, original] of originals) assert.equal(await readFile(join(root, path), "utf8"), original, `production source unchanged: ${path}`);
}

console.log(JSON.stringify({ sourceHashes: hashes, results }, null, 2));
assert.ok(results.every((result) => result.killed), "every source mutation must be detected by a semantic assertion");
