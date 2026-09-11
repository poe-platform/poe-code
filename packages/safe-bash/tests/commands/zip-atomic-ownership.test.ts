import assert from "node:assert/strict";
import test from "node:test";
import { FsError, Shell, archiveCommands, createMemoryFileSystem, type FileSystem } from "../../src/index.js";

function intercept(fs: FileSystem, before: (method: PropertyKey, args: unknown[]) => Promise<void>): FileSystem {
  return new Proxy(fs, { get(target, method) {
    const value: unknown = Reflect.get(target, method);
    if (typeof value !== "function") return value;
    return async (...args: unknown[]) => { await before(method, args); return Reflect.apply(value, target, args); };
  } });
}

for (const command of ["zip", "unzip"]) {
  test(`${command} refuses a destination replaced inside publication and preserves its bytes`, async context => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/input", Buffer.from("original payload"));
    const setup = new Shell({ fs, cwd: "/work" }).use(archiveCommands());
    context.after(() => setup.dispose());
    assert.equal((await setup.exec("zip archive.zip input")).exitCode, 0);
    const destination = command === "zip" ? "/work/archive.zip" : "/work/input";
    let injected = false;
    const wrapped = intercept(fs, async (method, args) => {
      if (!injected && (method === "rename" || method === "publishStagedFile") && args[1] === destination) {
        injected = true;
        await fs.rm(destination);
        await fs.writeFile(destination, Buffer.from("replacement owned by another operation"));
      }
    });
    const shell = new Shell({ fs: wrapped, cwd: "/work" }).use(archiveCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(command === "zip" ? "zip archive.zip input" : "unzip -o archive.zip");
    assert.equal(injected, true);
    assert.notEqual(result.exitCode, 0);
    assert.equal(Buffer.from(await fs.readFile(destination)).toString(), "replacement owned by another operation");
  });

  test(`${command} cleanup never removes a replacement inserted inside its mutation`, async context => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/input", Buffer.from("original payload"));
    const setup = new Shell({ fs, cwd: "/work" }).use(archiveCommands());
    context.after(() => setup.dispose());
    assert.equal((await setup.exec("zip archive.zip input")).exitCode, 0);
    let temporary = "";
    let injected = false;
    const wrapped = intercept(fs, async (method, args) => {
      if (method === "rename" || method === "publishStagedFile") {
        temporary = typeof args[0] === "string" ? args[0] : (args[0] as { file: { path: string } }).file.path;
        throw new FsError("EIO");
      }
      if (!injected && temporary && ((method === "rm" && args[0] === temporary) || method === "removeStagedFile")) {
        injected = true;
        await fs.rm(temporary);
        await fs.writeFile(temporary, Buffer.from("replacement must survive cleanup"));
      }
    });
    const shell = new Shell({ fs: wrapped, cwd: "/work" }).use(archiveCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(command === "zip" ? "zip archive.zip input" : "unzip -o archive.zip");
    assert.equal(injected, true);
    assert.notEqual(result.exitCode, 0);
    assert.equal(Buffer.from(await fs.readFile(temporary)).toString(), "replacement must survive cleanup");
  });
}

test("ZIP never claims a replacement inserted after staging creation as its own", async context => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", Buffer.from("payload"));
  let injected = false;
  let replacement = "";
  const wrapped = new Proxy(fs, { get(target, method) {
    const value: unknown = Reflect.get(target, method);
    if (typeof value !== "function") return value;
    return async (...args: unknown[]) => {
      const result: unknown = await Reflect.apply(value, target, args);
      const path = method === "createStagedFile" ? (result as { file: { path: string } }).file.path : args[0];
      if (!injected && ((method === "writeFile" && typeof path === "string" && path.includes("/.zip-")) || method === "createStagedFile")) {
        injected = true;
        replacement = path as string;
        const bytes = await fs.readFile(replacement);
        await fs.rm(replacement);
        await fs.writeFile(replacement, bytes);
      }
      return result;
    };
  } });
  const shell = new Shell({ fs: wrapped, cwd: "/work" }).use(archiveCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("zip archive.zip input");
  assert.equal(injected, true);
  assert.notEqual(result.exitCode, 0);
  await assert.rejects(fs.lstat("/work/archive.zip"), { code: "ENOENT" });
  assert.equal((await fs.lstat(replacement)).type, "file");
});

test("unzip omits unsupported metadata during atomic directory and file creation", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work/source", { recursive: true });
  await fs.writeFile("/work/source/input", Buffer.from("payload"));
  const setup = new Shell({ fs, cwd: "/work" }).use(archiveCommands());
  assert.equal((await setup.exec("zip archive.zip source/input")).exitCode, 0);
  await setup.dispose();
  let creations = 0;
  const wrapped = new Proxy(fs, { get(target, method) {
    if (method === "capabilities") return { ...target.capabilities, permissions: false, timestamps: false };
    const value: unknown = Reflect.get(target, method);
    if (typeof value !== "function") return value;
    return async (...args: unknown[]) => {
      if (method === "prepareDirectory" || method === "createStagedFile") {
        creations++;
        const options = args.at(-1) as { mode?: number; atimeMs?: number; mtimeMs?: number };
        assert.equal(options.mode, undefined);
        assert.equal(options.atimeMs, undefined);
        assert.equal(options.mtimeMs, undefined);
      }
      return Reflect.apply(value, target, args);
    };
  } });
  const shell = new Shell({ fs: wrapped, cwd: "/work" }).use(archiveCommands());
  try {
    const result = await shell.exec("unzip -d output archive.zip");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(creations, 3);
    assert.equal(Buffer.from(await fs.readFile("/work/output/source/input")).toString(), "payload");
  } finally { await shell.dispose(); }
});
