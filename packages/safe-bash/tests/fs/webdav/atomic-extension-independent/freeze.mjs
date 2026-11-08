import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const own = dirname(import.meta.filename);
const repo = resolve(own, "../../../..");
const output = join(own, "evidence", "freeze");
await mkdir(output, { recursive: true });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = args => execFileSync("git", args, { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
const candidate = git(["rev-parse", "d1174e2"]).toString().trim();
const predecessor = git(["rev-parse", "e9daab5"]).toString().trim();
const top = git(["ls-tree", "-r", "--name-only", candidate, "tests/fs/webdav"]).toString().trim().split("\n")
  .filter(path => /^tests\/fs\/webdav\/[^/]+\.(ts|json)$/u.test(path));
const guards = ["legacy-lock", "direct-comparison", "timestamp-postcondition", "lock-scope"]
  .map(name => `tests/fs/webdav/real-service/${name}.test.ts`);
const aliases = ["tests/fs/mount/copy-identity-guards.test.ts", "tests/fs/overlay/copy-identity.test.ts"];
const paths = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", ...top,
  ...guards, ...aliases, "tests/fs/overlay/helpers.ts", "tests/fs/webdav/real-service/evidence/apache-final/raw.json",
  "tests/fs/webdav/atomic-extension/capability.test.ts"];
const manifest = { capturedAt: new Date().toISOString(), candidate, predecessor,
  dirtySharedStatus: git(["status", "--short"]).toString(), staged: git(["diff", "--cached", "--name-only"]).toString(),
  original33: "tests/fs/webdav/atomic-extension/capability.test.ts", top, guards, aliases, archives: {}, inputs: {} };
for (const [name, revision, selected] of [["candidate", candidate, paths],
  ["predecessor", predecessor, ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json",
    "tests/fs/webdav/rmdir-atomic-extension/proposal.ts", "tests/fs/webdav/rmdir-atomic-extension/README.md"]]]) {
  const bytes = git(["archive", "--format=tar.gz", revision, ...selected]);
  await writeFile(join(output, `${name}.tar.gz`), bytes, { flag: "wx" });
  manifest.archives[name] = { revision, paths: selected, sha256: hash(bytes) };
  const entries = git(["ls-tree", "-r", "--name-only", revision, ...selected]).toString().trim().split("\n");
  manifest.inputs[name] = Object.fromEntries(entries.map(path => [path, hash(git(["show", `${revision}:${path}`]))]));
}
await writeFile(join(output, "source.diff"), git(["diff", predecessor, candidate, "--", "src", "package.json", "package-lock.json"]));
await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const observations = {};
for (const name of ["server.py", "example.mts", "https.mts", "dependencies.json"]) {
  const path = `tests/fs/webdav/atomic-extension/${name}`;
  const bytes = await readFile(join(repo, path));
  await writeFile(join(output, `author-observed-${name}.txt`), bytes);
  observations[path] = { sha256: hash(bytes), status: "read-only dirty observation; not frozen author service evidence" };
}
await writeFile(join(output, "author-observations.json"), JSON.stringify(observations, null, 2) + "\n");
console.log({ candidate, predecessor, files: Object.keys(manifest.inputs.candidate).length });
