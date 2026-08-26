import assert from "node:assert/strict";
import * as native from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { adapters, binary, errno } from "../../fs/conformance/fixtures.js";

for (const adapter of adapters) {
  test(`${adapter.name}: POLICY characterization of file/.. traversal`, async (context) => {
    const { fs } = await adapter.create(context);
    await fs.writeFile("/file", binary);
    if (adapter.name === "memory" || adapter.name === "real") {
      await assert.rejects(fs.stat("/file/.."), errno("ENOTDIR"));
      context.diagnostic("POLICY: file/.. requires a directory component on local adapters");
    } else {
      assert.equal((await fs.stat("/file/..")).type, "directory");
      context.diagnostic("POLICY DIVERGENCE: remote file/.. normalizes to root; no uniform guarantee asserted");
    }
    assert.deepEqual(await fs.readFile("/file"), binary);
  });

  test(`${adapter.name}: POLICY characterization of terminal-dot destructive source operands`, async (context) => {
    const { fs } = await adapter.create(context);
    for (const operation of ["rm", "rename"] as const) {
      for (const suffix of [".", "child/.."]) {
        const parent = `/${operation}-${suffix === "." ? "dot" : "dotdot"}`;
        await fs.mkdir(`${parent}/child`, { recursive: true });
        await fs.writeFile(`${parent}/file`, binary);
        const pending = operation === "rm" ? fs.rm(`${parent}/${suffix}`, { recursive: true })
          : fs.rename(`${parent}/${suffix}`, `${parent}-moved`);
        if (adapter.name === "memory" || adapter.name === "real") {
          await assert.rejects(pending, errno("EINVAL"));
          assert.deepEqual(await fs.readFile(`${parent}/file`), binary);
          assert.equal((await fs.stat(`${parent}/child`)).type, "directory");
          await assert.rejects(fs.stat(`${parent}-moved`), errno("ENOENT"));
        } else {
          await pending;
          await assert.rejects(fs.stat(parent), errno("ENOENT"));
          if (operation === "rename") assert.deepEqual(await fs.readFile(`${parent}-moved/file`), binary);
        }
      }
    }
    context.diagnostic(adapter.name === "memory" || adapter.name === "real"
      ? "POLICY: terminal . and .. source operands reject EINVAL without mutation"
      : "POLICY DIVERGENCE: remote terminal . and .. normalize before destructive operations; pending root policy");
  });
}

async function outcome(operation: () => Promise<void>): Promise<string> {
  try { await operation(); return "success"; }
  catch (error) {
    assert.ok(error instanceof Error && "code" in error && typeof error.code === "string");
    return error.code;
  }
}

for (const adapter of adapters.filter((candidate) => candidate.name === "memory" || candidate.name === "real")) {
  test(`${adapter.name}: POLICY characterization of trailing-slash symlink rm and rename`, async (context) => {
    const { fs, root } = await adapter.create(context);
    assert.ok(fs.symlink);
    for (const operation of ["rm", "rename"] as const) {
      const base = `/${operation}`;
      await fs.mkdir(`${base}/target`, { recursive: true });
      await fs.writeFile(`${base}/target/file`, binary);
      await fs.symlink("target", `${base}/link`);
      const actual = await outcome(() => operation === "rm" ? fs.rm(`${base}/link/`, { recursive: true })
        : fs.rename(`${base}/link/`, `${base}/moved`));
      assert.equal((await fs.lstat(`${base}/link`)).type, "symlink");
      if (adapter.name === "memory") {
        assert.equal(actual, "ENOTDIR");
        assert.deepEqual(await fs.readFile(`${base}/target/file`), binary);
        await assert.rejects(fs.stat(`${base}/moved`), errno("ENOENT"));
        context.diagnostic(`POLICY: memory ${operation}(link/) rejects ENOTDIR and preserves target`);
        continue;
      }
      assert.ok(root);
      assert.equal(actual, "success");
      await assert.rejects(fs.stat(`${base}/target`), errno("ENOENT"));
      if (operation === "rename") assert.deepEqual(await fs.readFile(`${base}/moved/file`), binary);
      const host = join(root, `native-${operation}`);
      await native.mkdir(join(host, "target"), { recursive: true });
      await native.writeFile(join(host, "target/file"), binary);
      await native.symlink("target", join(host, "link"));
      const nativeOutcome = await outcome(() => operation === "rm" ? native.rm(`${host}/link/`, { recursive: true })
        : native.rename(`${host}/link/`, join(host, "moved")));
      const nativeState: Record<string, string> = {};
      for (const name of ["link", "target", "moved"]) {
        try {
          const stat = await native.lstat(join(host, name));
          nativeState[name] = stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file";
          if (stat.isDirectory()) assert.deepEqual(new Uint8Array(await native.readFile(join(host, name, "file"))), binary);
        } catch (error) {
          assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
          nativeState[name] = "missing";
        }
      }
      context.diagnostic(`POLICY: ${JSON.stringify({ operation, adapter: { outcome: actual, link: "symlink", target: "missing", moved: operation === "rename" ? "directory" : "missing" }, native: { outcome: nativeOutcome, ...nativeState } })}; disposable native comparison, not a fidelity defect or raceproof guarantee`);
    }
  });
}
