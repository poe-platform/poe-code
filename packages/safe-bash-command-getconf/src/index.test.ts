import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createGetconfCommand, type GetconfCommandsOptions } from "./index.js";

async function runGetconf(args: string[], options: GetconfCommandsOptions = {}) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const cmd = createGetconfCommand(options);
  const res = await cmd.execute({
    command: "getconf",
    args: createCommandArguments(args).args,
    cwd: "/",
    env: {},
    fs,
    stdin: createBytePipe().readable,
    stdout: stdout.writable,
    stderr: stderr.writable,
    signal: new AbortController().signal,
  });
  await stdout.close();
  await stderr.close();
  const chunks: Uint8Array[] = [];
  for await (const c of stdout.readable) chunks.push(c);
  const errors: Uint8Array[] = [];
  for await (const c of stderr.readable) errors.push(c);
  return { exitCode: res.exitCode, stdout: Buffer.concat(chunks).toString("utf8"), stderr: Buffer.concat(errors).toString("utf8") };
}

test("getconf queries system and path variables and supports -a", async () => {
  assert.equal((await runGetconf(["PAGE_SIZE"])).stdout, "4096\n");
  assert.equal((await runGetconf(["_NPROCESSORS_ONLN"])).stdout, "4\n");
  assert.equal((await runGetconf(["NAME_MAX", "/tmp"])).stdout, "255\n");
  assert.equal((await runGetconf(["NAME_MAX", "/missing"])).exitCode, 1);
  assert.equal((await runGetconf(["UNKNOWN_VAR"])).exitCode, 1);
  assert.match((await runGetconf(["-a"])).stdout, /PAGE_SIZE/);
});

for (const name of ["OPEN_MAX", "ARG_MAX", "CLK_TCK", "NPROCESSORS_ONLN", "NPROCESSORS_CONF", "PAGE_SIZE", "PAGESIZE"]) {
  test(`getconf resolves _SC_${name} to the configured system value`, async () => {
    const options = { processors: 8, variables: { PAGE_SIZE: 8192, PAGESIZE: 8192, OPEN_MAX: 2048 } };
    const expected = await runGetconf([name], options);
    assert.equal(expected.exitCode, 0);
    assert.deepEqual(await runGetconf([`_SC_${name}`], options), expected);
  });
}

test("getconf preserves explicit aliases and existing string/path prefixes", async () => {
  assert.equal((await runGetconf(["_SC_OPEN_MAX"], { variables: { _SC_OPEN_MAX: 42 } })).stdout, "42\n");
  assert.deepEqual(await runGetconf(["_CS_PATH"]), await runGetconf(["PATH"]));
  assert.deepEqual(await runGetconf(["_PC_NAME_MAX", "/tmp"]), await runGetconf(["NAME_MAX", "/tmp"]));
});

for (const name of ["LINK_MAX", "FILESIZEBITS", "_PC_LINK_MAX", "_POSIX_NO_TRUNC"]) {
  test(`getconf requires a pathname for ${name}`, async () => {
    assert.deepEqual(await runGetconf([name]), {
      exitCode: 1, stdout: "", stderr: `getconf: ${name} requires a pathname\n`,
    });
    assert.equal((await runGetconf([name, "/tmp"])).exitCode, 0);
    assert.equal((await runGetconf([name, "/missing"])).exitCode, 1);
  });
}

for (const name of ["ARG_MAX", "_SC_OPEN_MAX", "_CS_PATH"]) {
  test(`getconf rejects a pathname for ${name}`, async () => {
    for (const path of ["/tmp", "/missing"]) {
      assert.deepEqual(await runGetconf([name, path]), {
        exitCode: 1, stdout: "", stderr: `getconf: ${name} does not accept a pathname\n`,
      });
    }
  });
}

test("getconf keeps optional pathnames for common limits", async () => {
  for (const name of ["NAME_MAX", "PATH_MAX", "PIPE_BUF", "_PC_NAME_MAX", "_PC_PATH_MAX", "_PC_PIPE_BUF"]) {
    const expected = await runGetconf([name, "/tmp"]);
    assert.equal(expected.exitCode, 0);
    assert.deepEqual(await runGetconf([name]), expected);
  }
});
