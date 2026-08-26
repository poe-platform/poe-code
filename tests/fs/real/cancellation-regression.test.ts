import assert from "node:assert/strict";
import * as native from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { FsOptions } from "../../../src/contracts/index.js";
import type { RealFileSystem } from "../../../src/fs/real/index.js";
import { bytes, fixture, text } from "./helpers.js";

interface ResolutionHooks {
  path(path: string, options?: FsOptions): Promise<string>;
  root(options?: FsOptions): Promise<string>;
  walk(root: string, components: unknown[], options: FsOptions & { checkTarget?: boolean }): Promise<string>;
}

async function snapshot(root: string): Promise<unknown[]> {
  const entries = await native.readdir(root);
  return Promise.all(entries.sort().map(async (name) => {
    const path = join(root, name);
    const stats = await native.lstat(path);
    return {
      name, mode: stats.mode, mtimeMs: stats.mtimeMs, ino: stats.ino, nlink: stats.nlink,
      data: stats.isFile() ? await native.readFile(path, "utf8") : undefined,
      target: stats.isSymbolicLink() ? await native.readlink(path) : undefined,
      entries: stats.isDirectory() ? await snapshot(path) : undefined,
    };
  }));
}

const mutations: {
  name: string;
  boundary: string;
  run(filesystem: RealFileSystem, options: FsOptions): Promise<void>;
}[] = [
  { name: "rm", boundary: "/victim", run: (filesystem, options) => filesystem.rm("/victim", options) },
  { name: "rename source", boundary: "/source", run: (filesystem, options) => filesystem.rename("/source", "/victim", options) },
  { name: "rename destination", boundary: "/victim", run: (filesystem, options) => filesystem.rename("/source", "/victim", options) },
  { name: "copyFile source", boundary: "/source", run: (filesystem, options) => filesystem.copyFile("/source", "/victim", options) },
  { name: "copyFile destination", boundary: "/victim", run: (filesystem, options) => filesystem.copyFile("/source", "/victim", options) },
  { name: "mkdir", boundary: "/created", run: (filesystem, options) => filesystem.mkdir("/created", options) },
  { name: "symlink", boundary: "/created", run: (filesystem, options) => filesystem.symlink("/source", "/created", options) },
  { name: "link", boundary: "/created", run: (filesystem, options) => filesystem.link("/source", "/created", options) },
  { name: "chmod", boundary: "/victim", run: (filesystem, options) => filesystem.chmod("/victim", 0o400, options) },
  { name: "utimes", boundary: "/victim", run: (filesystem, options) => filesystem.utimes("/victim", 1000, 2000, options) },
  { name: "truncate", boundary: "/victim", run: (filesystem, options) => filesystem.truncate("/victim", 0, options) },
  { name: "writeFile", boundary: "/victim", run: (filesystem, options) => filesystem.writeFile("/victim", bytes("replace"), options) },
  { name: "appendFile", boundary: "/victim", run: (filesystem, options) => filesystem.appendFile("/victim", bytes("append"), options) },
];

for (const mutation of mutations) {
  test(`cancellation after ${mutation.name} resolution does not start a mutation`, async (context) => {
    const { filesystem, root } = await fixture(context);
    await filesystem.writeFile("/victim", bytes("keep"));
    await filesystem.writeFile("/source", bytes("source"));
    const before = await snapshot(root);
    const controller = new AbortController();
    const reason = new Error(`cancel ${mutation.name}`);
    const hooks = filesystem as unknown as ResolutionHooks;
    const resolvePath = hooks.path.bind(filesystem);
    hooks.path = async (path, options) => {
      const result = await resolvePath(path, options);
      if (path === mutation.boundary) controller.abort(reason);
      return result;
    };
    await assert.rejects(mutation.run(filesystem, { signal: controller.signal }), (error) => error === reason);
    assert.deepEqual(await snapshot(root), before);
  });
}

for (const operation of ["rm", "rename"] as const) {
  test(`${operation} checks cancellation after final root verification`, async (context) => {
    const { filesystem, root } = await fixture(context);
    await filesystem.writeFile("/victim", bytes("keep"));
    await filesystem.writeFile("/source", bytes("source"));
    const before = await snapshot(root);
    const controller = new AbortController();
    const reason = new Error("cancel final root verification");
    const hooks = filesystem as unknown as ResolutionHooks;
    const resolvePath = hooks.path.bind(filesystem);
    const resolveRoot = hooks.root.bind(filesystem);
    let resolved = false;
    hooks.path = async (path, options) => {
      const result = await resolvePath(path, options);
      if (path === "/victim") resolved = true;
      return result;
    };
    hooks.root = async (options) => {
      const result = await resolveRoot(options);
      if (resolved) controller.abort(reason);
      return result;
    };
    const options = { signal: controller.signal };
    const pending = operation === "rm"
      ? filesystem.rm("/victim", options)
      : filesystem.rename("/source", "/victim", options);
    await assert.rejects(pending, (error) => error === reason);
    assert.deepEqual(await snapshot(root), before);
  });
}

test("recursive mkdir checks cancellation after root resolution before creating parents", async (context) => {
  const { filesystem, root } = await fixture(context);
  const controller = new AbortController();
  const reason = new Error("cancel traversal");
  const hooks = filesystem as unknown as ResolutionHooks;
  const resolveRoot = hooks.root.bind(filesystem);
  hooks.root = async (options) => {
    const result = await resolveRoot(options);
    controller.abort(reason);
    return result;
  };
  await assert.rejects(filesystem.mkdir("/created/child", {
    recursive: true, signal: controller.signal,
  }), (error) => error === reason);
  assert.deepEqual(await native.readdir(root), []);
});

test("symlink checks cancellation after target traversal before creation", async (context) => {
  const { filesystem, root } = await fixture(context);
  const controller = new AbortController();
  const reason = new Error("cancel target traversal");
  const hooks = filesystem as unknown as ResolutionHooks;
  const walk = hooks.walk.bind(filesystem);
  hooks.walk = async (root, components, options) => {
    const result = await walk(root, components, options);
    if (options.checkTarget) controller.abort(reason);
    return result;
  };
  await assert.rejects(filesystem.symlink("missing", "/created", {
    signal: controller.signal,
  }), (error) => error === reason);
  assert.deepEqual(await native.readdir(root), []);
});

test("cancellation keeps completed stream writes without promising rollback", async (context) => {
  const { filesystem } = await fixture(context);
  const controller = new AbortController();
  const reason = new Error("cancel after first chunk");
  async function* source() {
    yield bytes("completed");
    controller.abort(reason);
    yield bytes("not written");
  }
  await assert.rejects(filesystem.writeStream("/partial", source(), {
    signal: controller.signal,
  }), (error) => error === reason);
  assert.equal(text(await filesystem.readFile("/partial")), "completed");
});
