import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const args of ["-- -p", "-- --parents", "-- --", "-p -- -p --parents --", "--parents -- -p --parents --"]) {
  test(`mkdir preserves option-like operands in ${args}`, async context => {
    const fs = await fixture();
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`mkdir ${args}`);
    assert.equal(result.exitCode, 0, result.stderr);
    const operands = args.slice(args.indexOf("-- ") + 3).split(" ");
    for (const operand of operands) assert.equal((await fs.stat(`/work/${operand}`)).type, "directory");
  });
}

for (const [mode, expected] of [["u=rwx,go=rx", 0o755], ["a=rx", 0o555], ["+t", 0o1755], ["g=u", 0o775], ["a+X", 0o755], ["700", 0o700]] as const) {
  test(`mkdir -m ${mode} creates the requested directory mode`, async () => {
    const fs = await fixture();
    const result = await run("mkdir", ["-p", "-m", mode, "parent/child"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/work/parent/child")).mode & 0o7777, expected);
  });
}

test("mkdir symbolic modes use the shell's current umask and preserve parent modes", async context => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("umask 077; mkdir -p -m +t parent/child; mkdir -m u+rwx user; mkdir -m a=rx readonly");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/work/parent")).mode & 0o7777, 0o700);
  assert.equal((await fs.stat("/work/parent/child")).mode & 0o7777, 0o1700);
  assert.equal((await fs.stat("/work/user")).mode & 0o7777, 0o700);
  assert.equal((await fs.stat("/work/readonly")).mode & 0o7777, 0o555);
});

test("recursive mkdir does not partially mutate operands before fallback admission", async () => {
  const fs = await fixture({ blocked: "file" });
  const { filesystemCommands } = await import("../../src/commands/filesystem.js");
  const { toByteSource } = await import("../../src/contracts/index.js");
  const observed: boolean[] = [];
  const wrapper = new Proxy(fs, {
    get(target, key) {
      if (key === "mkdir") return async (...args: Parameters<typeof fs.mkdir>) => {
        if (args[0] === "/work/first") {
          observed.push(await fs.stat("/work/first").then(() => true, () => false));
        }
        return fs.mkdir(...args);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const result = await filesystemCommands().find(command => command.name === "mkdir")!.execute({
    ...{ _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true, _chargeFastFsOp() {} },
    command: "mkdir", args: ["-p", "first", "blocked/child"], cwd: "/work", env: {}, fs: wrapper,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(observed, [false]);
  assert.equal((await fs.stat("/work/first")).type, "directory");
});
