import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem } from "../../../src/contracts/index.js";
import { filesystem, run } from "./helpers.js";
import { Shell } from "../../../src/shell/index.js";
import { diffPatchCommands } from "../../../src/commands/diff-patch/index.js";
import { creationFileSystem } from "../../../src/shell/umask.js";
import { deferred, drain, snapshot } from "../diff-patch-stress/safety/helpers.js";

for (const atomic of [false, true]) {
  test(`patch refuses an ancestor swap at publication: atomic=${atomic}`, async () => {
    const backing = await filesystem({ "out/sub/target": "old\n" });
    await backing.mkdir("/private");
    await backing.writeFile("/private/target", Buffer.from("old\n"));
    let swapped = false;
    const swap = async () => {
      if (swapped) return;
      swapped = true;
      await backing.rename("/work/out/sub", "/work/out/retired");
      await backing.symlink("/private", "/work/out/sub");
    };
    const fs = new Proxy(backing, {
      get(target, property) {
        if (property === "writeFile") return async (...args: Parameters<FileSystem["writeFile"]>) => {
          if (args[0] === "/work/out/sub/target") await swap();
          return target.writeFile(...args);
        };
        if (property === "publishStagedFile") return async (...args: Parameters<NonNullable<FileSystem["publishStagedFile"]>>) => {
          await swap();
          return target.publishStagedFile(...args);
        };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await run("patch", ["-d", "/work/out", "-p0", ...(atomic ? ["--atomic"] : [])], {
      fs, input: "--- sub/target\n+++ sub/target\n@@ -1 +1 @@\n-old\n+new\n",
    });
    assert.equal(swapped, true);
    assert.notEqual(result.exitCode, 0);
    assert.equal(Buffer.from(await backing.readFile("/private/target")).toString(), "old\n");
    assert.equal(Buffer.from(await backing.readFile("/work/out/retired/target")).toString(), "old\n");
  });
}

for (const atomic of [false, true]) for (const parent of ["/authorized", "/authorized/deep"]) {
  test(`patch prunes an explicit target outside cwd: ${parent}, atomic=${atomic}`, async () => {
    const fs = await filesystem({ sentinel: "untouched\n", decoy: "old\n" });
    const before = await snapshot(fs);
    await fs.mkdir(parent, { recursive: true });
    await fs.writeFile(`${parent}/target`, Buffer.from("old\n"));
    const result = await run("patch", ["-E", ...(atomic ? ["--atomic"] : []), `${parent}/target`], {
      fs, input: "--- decoy\n+++ decoy\n@@ -1 +0,0 @@\n-old\n",
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(await snapshot(fs), before, "only the explicit target and its empty parents are removed");
  });
}

for (const parent of ["/authorized", "/authorized/deep"]) {
  test(`patch pruning rejects an external parent replacement: ${parent}`, async () => {
    const backing = await filesystem({ sentinel: "untouched\n" });
    await backing.mkdir(parent, { recursive: true });
    await backing.writeFile(`${parent}/target`, Buffer.from("old\n"));
    let swapped = false;
    const fs = new Proxy(backing, {
      get(target, property) {
        if (property === "confineExtraction") return async (...args: Parameters<NonNullable<FileSystem["confineExtraction"]>>) => {
          const confined = await target.confineExtraction(...args);
          return new Proxy(confined, {
            get(view, key) {
              if (key === "rmdir") return async (...remove: Parameters<NonNullable<FileSystem["rmdir"]>>) => {
                assert.equal(remove[0], parent);
                swapped = true;
                await backing.rename("/authorized", "/retired");
                await backing.mkdir(parent, { recursive: true });
                return view.rmdir!(...remove);
              };
              const value: unknown = Reflect.get(view, key, view);
              return typeof value === "function" ? value.bind(view) : value;
            },
          });
        };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await run("patch", ["-E", `${parent}/target`], {
      fs, input: "--- label\n+++ label\n@@ -1 +0,0 @@\n-old\n",
    });
    assert.equal(swapped, true);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /EAGAIN/u);
    assert.equal((await backing.lstat(parent)).type, "directory", "the replacement directory survives");
    assert.equal(Buffer.from(await backing.readFile("/work/sentinel")).toString(), "untouched\n");
  });
}

test("patch refuses mutation without atomic ancestry support but permits dry-run", async () => {
  const backing = await filesystem({ target: "old\n" });
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "confineExtraction") return undefined;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const input = "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n";
  const result = await run("patch", [], { fs, input });
  assert.notEqual(result.exitCode, 0);
  assert.equal(Buffer.from(await backing.readFile("/work/target")).toString(), "old\n");
  assert.equal((await run("patch", ["--dry-run"], { fs, input })).exitCode, 0);
});

test("staged patch creation honors the shell umask", async () => {
  const fs = await filesystem();
  const result = await new Shell({ fs, cwd: "/work" }).use(diffPatchCommands()).exec("umask 077; patch", {
    stdin: "--- /dev/null\n+++ target\n@@ -0,0 +1 @@\n+new\n",
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/work/target")).mode & 0o777, 0o600);
});

test("staging symlinks preserves their default mode", async () => {
  const fs = await filesystem();
  const view = creationFileSystem(fs, 0o077);
  const staging = await view.createStagedFile!("/work/staging", "entry", { type: "symlink", target: "target" }, {
    parent: await fs.stat("/work"),
  });
  assert.equal(staging.file.stat.mode & 0o777, 0o777);
  await fs.removeStagedFile(staging);
});

for (const output of ["target.orig", "target.rej", "result"]) {
  test(`patch pins ancestry when publishing ${output}`, async () => {
    const backing = await filesystem({ "out/sub/target": "wrong\n" });
    await backing.mkdir("/private");
    await backing.writeFile(`/private/${output}`, Buffer.from("private\n"));
    let swapped = false;
    const fs = new Proxy(backing, {
      get(target, property) {
        if (property === "publishStagedFile") return async (...args: Parameters<NonNullable<FileSystem["publishStagedFile"]>>) => {
          if (args[1] === `/work/out/sub/${output}`) {
            swapped = true;
            await backing.rename("/work/out/sub", "/work/out/retired");
            await backing.symlink("/private", "/work/out/sub");
          }
          return target.publishStagedFile(...args);
        };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const args = ["-d", "/work/out", "-p0", "--force", ...(output === "result" ? ["-o", "sub/result"] : [])];
    const result = await run("patch", args, { fs, input: "--- sub/target\n+++ sub/target\n@@ -1 +1 @@\n-old\n+new\n" });
    assert.equal(swapped, true);
    assert.notEqual(result.exitCode, 0);
    assert.equal(Buffer.from(await backing.readFile(`/private/${output}`)).toString(), "private\n");
  });
}

test("patch removal rejects an ancestor swap at the backend boundary", async () => {
  const backing = await filesystem({ "out/sub/target": "old\n" });
  await backing.mkdir("/private");
  await backing.writeFile("/private/target", Buffer.from("old\n"));
  let swapped = false;
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "confineExtraction") return async (...args: Parameters<NonNullable<FileSystem["confineExtraction"]>>) => {
        const confined = await target.confineExtraction(...args);
        return new Proxy(confined, {
          get(view, key) {
            if (key === "rm") return async (...remove: Parameters<FileSystem["rm"]>) => {
              swapped = true;
              await backing.rename("/work/out/sub", "/work/out/retired");
              await backing.symlink("/private", "/work/out/sub");
              return view.rm(...remove);
            };
            const value: unknown = Reflect.get(view, key, view);
            return typeof value === "function" ? value.bind(view) : value;
          },
        });
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const result = await run("patch", ["-d", "/work/out", "-p0"], {
    fs, input: "--- sub/target\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n",
  });
  assert.equal(swapped, true);
  assert.notEqual(result.exitCode, 0);
  assert.equal(Buffer.from(await backing.readFile("/private/target")).toString(), "old\n");
  assert.equal(Buffer.from(await backing.readFile("/work/out/retired/target")).toString(), "old\n");
});

test("patch publication rejects a private hardlink substituted for the destination", async () => {
  const fs = await filesystem({ target: "old\n" });
  await fs.mkdir("/private");
  await fs.writeFile("/private/target", Buffer.from("old\n"));
  const publish = fs.publishStagedFile.bind(fs);
  fs.publishStagedFile = async (...args) => {
    await fs.rm("/work/target");
    await fs.link("/private/target", "/work/target");
    return publish(...args);
  };
  const result = await run("patch", [], { fs, input: "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n" });
  assert.notEqual(result.exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/private/target")).toString(), "old\n");
});

for (const acquisition of ["receipt", "rejection"]) test(`Shell cancellation drains admitted patch staging ${acquisition} before settlement`, async () => {
  const backing = await filesystem({ target: "old\n" });
  const before = await snapshot(backing);
  const acquired = deferred<void>();
  const receipt = deferred<void>();
  const controller = new AbortController();
  const reason = new Error("cancel patch staging acquisition");
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
        if (acquisition === "rejection") {
          acquired.resolve();
          await receipt.promise;
          throw new Error("late acquisition rejection");
        }
        const staging = await target.createStagedFile(...args);
        acquired.resolve();
        await receipt.promise;
        return staging;
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const shell = new Shell({ fs, cwd: "/work" }).use(diffPatchCommands());
  let settled = false;
  const rejected = assert.rejects(shell.exec("patch", {
    stdin: "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n",
    signal: controller.signal,
  }), error => error === reason).finally(() => { settled = true; });
  try {
    await acquired.promise;
    controller.abort(reason);
    await drain();
    assert.equal(settled, false, "the admitted staging receipt still needs cleanup");
  } finally {
    receipt.resolve();
    await rejected;
    await shell.dispose();
  }
  assert.deepEqual(await snapshot(backing), before, "no target mutation or retained staging after settlement");
});
