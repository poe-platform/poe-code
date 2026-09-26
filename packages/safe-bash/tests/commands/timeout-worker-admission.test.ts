import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import { captureAgentWorkerRecipe } from "../../src/plugins/worker-recipes.js";

test("worker devices share the parent filesystem operation budget", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new TextEncoder().encode("data"));
  const shell = new Shell({ fs });
  shell.use(agentCommands());
  try {
    for (const command of ["cat /file; cat /dev/null; cat /dev/null", "cat /file; timeout -k0.02 2 sh -c 'cat /dev/null; cat /dev/null'"]) {
      await assert.rejects(shell.exec(command, { limits: { maxFileSystemOperations: 2 } }), {
        name: "ShellLimitError", limit: "maxFileSystemOperations",
      });
    }
  } finally { await shell.dispose(); }
});

test("worker filesystem retains an explicitly provided device namespace", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dev");
  await fs.writeFile("/dev/null", new TextEncoder().encode("provided device"));
  const shell = new Shell({ fs, deviceView: "provided" });
  shell.use(agentCommands());
  try {
    const result = await shell.exec("timeout -k0.02 2 cat /dev/null");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "provided device");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("worker filesystem charges retain their invocation owner across concurrent shells", async () => {
  for (const interleave of [false, true]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", new TextEncoder().encode("data"));
    const shell = new Shell({ fs });
    const rival = new Shell({ fs });
    shell.use(agentCommands());
    rival.use(agentCommands());
    let output = "";
    try {
      await assert.rejects(shell.exec("cat /file; timeout -k0.02 2 sh -c 'printf ready; cat /file'", {
        limits: { maxFileSystemOperations: 1 },
        stdout: { async write(chunk) {
          const text = new TextDecoder().decode(chunk);
          output += text;
          if (interleave && text === "ready") assert.equal((await rival.exec("cat /file")).stdout, "data");
        } },
      }), { name: "ShellLimitError", limit: "maxFileSystemOperations" });
      assert.equal(output, "dataready");
    } finally { await shell.dispose(); await rival.dispose(); }
  }
});

test("kill-after refuses finite shared interpreter quotas instead of resetting them", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(agentCommands());
  try {
    const result = await shell.exec("timeout -k0.02 2 sh -c 'printf escaped'", { limits: { maxCommands: 10 } });
    assert.equal(result.exitCode, 125);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /shared interpreter quotas/);
  } finally { await shell.dispose(); }
});

test("worker admission preserves the caller's finite substitution depth ceiling", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  const limits = { maxSubstitutionDepth: 3 };
  try {
    await assert.rejects(shell.exec(`printf "$(printf "$(timeout 2 sh -c 'printf "$(printf leaked)"')")"`, { limits }), {
      name: "ShellLimitError", limit: "maxSubstitutionDepth",
    });
    const nested = await shell.exec(`printf "$(printf "$(timeout -k0.02 2 sh -c 'printf "$(printf leaked)"')")"`, { limits });
    assert.equal(nested.stdout, "");
    assert.match(nested.stderr, /shared interpreter quotas/);
    const direct = await shell.exec("timeout -k0.02 2 printf leaked", { limits });
    assert.equal(direct.exitCode, 125);
    assert.equal(direct.stdout, "");
  } finally { await shell.dispose(); }
});

test("worker admission refuses shell descriptors it cannot preserve", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const ordinary = await shell.exec("timeout 2 sh -c 'printf started; printf retained >&3' 3>/ordinary");
    assert.equal(ordinary.exitCode, 0);
    assert.equal(ordinary.stdout, "started");
    assert.equal(new TextDecoder().decode(await fs.readFile("/ordinary")), "retained");
    const isolated = await shell.exec("timeout -k0.02 2 sh -c 'printf started; printf retained >&3' 3>/isolated");
    assert.equal(isolated.exitCode, 125);
    assert.equal(isolated.stdout, "");
    assert.match(isolated.stderr, /retained handles/);
    assert.equal((await fs.readFile("/isolated")).byteLength, 0);
  } finally { await shell.dispose(); }
});

test("kill-after never silently drops host middleware", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(agentCommands()).use(async (context, next) => context.command === "printf" ? { exitCode: 7 } : next());
  try {
    const result = await shell.exec("timeout -k0.02 2 printf escaped");
    assert.equal(result.exitCode, 125);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /worker modules/);
  } finally { await shell.dispose(); }
});

test("worker recipes refuse properties structuredClone would discard", () => {
  const options = Object.defineProperty({}, "timeout", { value: {}, enumerable: false });
  assert.equal(captureAgentWorkerRecipe(options), undefined);
});

test("worker filesystem errors retain the ordinary utility diagnostic", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(agentCommands());
  try {
    const ordinary = await shell.exec("cat /missing");
    const isolated = await shell.exec("timeout -k0.02 2 cat /missing");
    assert.equal(isolated.exitCode, ordinary.exitCode);
    assert.equal(isolated.stderr, ordinary.stderr);
  } finally { await shell.dispose(); }
});

test("verbose escalation reports both actual worker signals", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(agentCommands());
  try {
    const result = await shell.exec("timeout -v -k0.02 0.2 sh -c 'trap \"\" TERM; while :; do :; done'");
    assert.equal(result.exitCode, 137);
    assert.equal(result.stderr, "timeout: sending signal TERM to command ‘sh’\ntimeout: sending signal KILL to command ‘sh’\n");
  } finally { await shell.dispose(); }
});

test("worker bootstrap failure reports timeout's utility failure status", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), workerModules: [{
    specifier: new URL("./timeout-worker-fixture.ts", import.meta.url).href,
    exportName: "notAnExport",
  }] });
  shell.use(agentCommands());
  try {
    const result = await shell.exec("timeout -k0.02 2 printf escaped");
    assert.equal(result.exitCode, 125);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /timeout: Worker module export must be a factory/);
  } finally { await shell.dispose(); }
});
