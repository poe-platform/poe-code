import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { createDockerRunner, createHostRunner } from "../index.js";
import type { Engine } from "../index.js";

const dockerPortHost = 18923;

async function verifyHostPiped() {
  const runner = createHostRunner();
  const handle = runner.exec({
    command: "echo",
    args: ["hello"],
    stdout: "pipe",
    stderr: "pipe"
  });
  const stdoutPromise = readStream(handle.stdout, "host piped stdout");

  const { exitCode } = await handle.result;
  const stdout = await stdoutPromise;
  assert.equal(exitCode, 0, "host piped: exit code 0");
  assert.equal(stdout.trim(), "hello", "host piped: stdout captured");
  console.log("✓ host runner — piped mode");
}

async function verifyHostStdin() {
  const runner = createHostRunner();
  const handle = runner.exec({
    command: "cat",
    stdin: "pipe",
    stdout: "pipe"
  });
  const stdoutPromise = readStream(handle.stdout, "host stdin stdout");

  const stdin = assertWritable(handle.stdin, "host stdin: stdin available");
  stdin.write("ping");
  stdin.end();

  const { exitCode } = await handle.result;
  const stdout = await stdoutPromise;
  assert.equal(exitCode, 0, "host stdin: exit code 0");
  assert.equal(stdout, "ping", "host stdin: stdin echoed to stdout");
  console.log("✓ host runner — stdin pipe");
}

async function verifyHostKill() {
  const runner = createHostRunner();
  const handle = runner.exec({
    command: "sleep",
    args: ["60"],
    stdout: "pipe",
    stderr: "pipe"
  });

  await delay(100);
  handle.kill("SIGTERM");

  const { exitCode } = await handle.result;
  assert.notEqual(exitCode, 0, "host kill: non-zero exit after SIGTERM");
  console.log("✓ host runner — kill");
}

async function verifyHostAbort() {
  const runner = createHostRunner();
  const controller = new AbortController();
  const handle = runner.exec({
    command: "sleep",
    args: ["60"],
    stdout: "pipe",
    stderr: "pipe",
    signal: controller.signal
  });

  await delay(100);
  controller.abort();

  const { exitCode } = await handle.result;
  assert.notEqual(exitCode, 0, "host abort: non-zero exit after abort");
  console.log("✓ host runner — abort signal");
}

async function verifyHostInherit() {
  const runner = createHostRunner();
  const handle = runner.exec({
    command: "echo",
    args: ["inherit-mode-output"],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });

  assert.equal(handle.stdout, null, "host inherit: stdout is null");
  assert.equal(handle.stderr, null, "host inherit: stderr is null");
  assert.equal(handle.stdin, null, "host inherit: stdin is null");

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 0, "host inherit: exit code 0");
  console.log("✓ host runner — inherit mode");
}

async function verifyHostExitCode() {
  const runner = createHostRunner();
  const handle = runner.exec({
    command: "sh",
    args: ["-c", "exit 42"],
    stdout: "pipe",
    stderr: "pipe"
  });

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 42, "host exit code: 42");
  console.log("✓ host runner — non-zero exit code");
}

async function verifyHostEnv() {
  const runner = createHostRunner();
  const handle = runner.exec({
    command: "sh",
    args: ["-c", "printf %s \"$MY_TEST_VAR\""],
    stdout: "pipe",
    env: { ...process.env, MY_TEST_VAR: "runner-works" }
  });
  const stdoutPromise = readStream(handle.stdout, "host env stdout");

  const { exitCode } = await handle.result;
  const stdout = await stdoutPromise;
  assert.equal(exitCode, 0, "host env: exit code 0");
  assert.equal(stdout, "runner-works", "host env: env var passed");
  console.log("✓ host runner — env vars");
}

async function verifyDockerPiped(engine: Engine) {
  const runner = createDockerRunner({ image: "alpine:latest", engine, context: "" });
  const handle = runner.exec({
    command: "echo",
    args: ["hello from docker"],
    stdout: "pipe",
    stderr: "pipe"
  });
  const stdoutPromise = readStream(handle.stdout, "docker piped stdout");

  const { exitCode } = await handle.result;
  const stdout = await stdoutPromise;
  assert.equal(exitCode, 0, "docker piped: exit code 0");
  assert.equal(stdout.trim(), "hello from docker", "docker piped: stdout captured");
  console.log("✓ docker runner — piped mode");
}

async function verifyDockerStdin(engine: Engine) {
  const runner = createDockerRunner({ image: "alpine:latest", engine, context: "" });
  const handle = runner.exec({
    command: "cat",
    stdin: "pipe",
    stdout: "pipe"
  });
  const stdoutPromise = readStream(handle.stdout, "docker stdin stdout");

  const stdin = assertWritable(handle.stdin, "docker stdin: stdin available");
  stdin.write("docker-ping");
  stdin.end();

  const { exitCode } = await handle.result;
  const stdout = await stdoutPromise;
  assert.equal(exitCode, 0, "docker stdin: exit code 0");
  assert.equal(stdout, "docker-ping", "docker stdin: stdin echoed to stdout");
  console.log("✓ docker runner — stdin pipe");
}

async function verifyDockerKill(engine: Engine) {
  const runner = createDockerRunner({ image: "alpine:latest", engine, context: "" });
  const handle = runner.exec({
    command: "sleep",
    args: ["60"],
    stdout: "pipe",
    stderr: "pipe"
  });

  await delay(1000);
  handle.kill("SIGTERM");

  const { exitCode } = await handle.result;
  assert.notEqual(exitCode, 0, "docker kill: non-zero exit after SIGTERM");
  console.log("✓ docker runner — kill");
}

async function verifyDockerExitCode(engine: Engine) {
  const runner = createDockerRunner({ image: "alpine:latest", engine, context: "" });
  const handle = runner.exec({
    command: "sh",
    args: ["-c", "exit 42"],
    stdout: "pipe",
    stderr: "pipe"
  });

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 42, "docker exit code: 42");
  console.log("✓ docker runner — non-zero exit code");
}

async function verifyDockerEnv(engine: Engine) {
  const runner = createDockerRunner({ image: "alpine:latest", engine, context: "" });
  const handle = runner.exec({
    command: "sh",
    args: ["-c", "printf %s \"$MY_TEST_VAR\""],
    stdout: "pipe",
    env: { MY_TEST_VAR: "docker-runner-works" }
  });
  const stdoutPromise = readStream(handle.stdout, "docker env stdout");

  const { exitCode } = await handle.result;
  const stdout = await stdoutPromise;
  assert.equal(exitCode, 0, "docker env: exit code 0");
  assert.equal(stdout, "docker-runner-works", "docker env: env var passed");
  console.log("✓ docker runner — env vars");
}

async function verifyDockerMount(engine: Engine) {
  const mountRoot = mkdtempSync(path.join(tmpdir(), "process-runner-verify-"));
  const mountFile = path.join(mountRoot, "mounted.txt");
  writeFileSync(mountFile, "mounted-ok\n", "utf8");

  try {
    const runner = createDockerRunner({
      image: "alpine:latest",
      engine,
      context: "",
      mounts: [{ source: mountRoot, target: "/host-data", readonly: true }]
    });
    const handle = runner.exec({
      command: "cat",
      args: ["/host-data/mounted.txt"],
      stdout: "pipe",
      stderr: "pipe"
    });
    const stdoutPromise = readStream(handle.stdout, "docker mount stdout");

    const { exitCode } = await handle.result;
    const stdout = await stdoutPromise;
    assert.equal(exitCode, 0, "docker mount: exit code 0");
    assert.equal(stdout.trim(), "mounted-ok", "docker mount: mounted file available");
    console.log("✓ docker runner — bind mount");
  } finally {
    rmSync(mountRoot, { recursive: true, force: true });
  }
}

async function verifyDockerPort(engine: Engine) {
  const runner = createDockerRunner({
    image: "alpine:latest",
    engine,
    context: "",
    ports: [{ host: dockerPortHost, container: 8080 }]
  });
  const handle = runner.exec({
    command: "sh",
    args: [
      "-c",
      "mkdir -p /srv/http && printf ok > /srv/http/index.html && exec busybox httpd -f -p 8080 -h /srv/http"
    ],
    stdout: "pipe",
    stderr: "pipe"
  });

  try {
    await waitForHttpOk(`http://127.0.0.1:${dockerPortHost}`);
    console.log("✓ docker runner — port mapping");
  } finally {
    handle.kill("SIGTERM");
    await handle.result;
  }
}

async function verifyDockerInteractiveContract(engine: Engine) {
  const runner = createDockerRunner({ image: "alpine:latest", engine, context: "" });
  const handle = runner.exec({
    command: "sh",
    args: [
      "-c",
      "if [ -t 0 ]; then printf stdin-is-tty; else printf stdin-not-tty; fi; printf '\\n'; if [ -t 1 ]; then printf stdout-is-tty; else printf stdout-not-tty; fi"
    ],
    stdin: "pipe",
    stdout: "pipe",
    tty: true
  });
  const stdoutPromise = readStream(handle.stdout, "docker interactive stdout");

  const stdin = assertWritable(handle.stdin, "docker interactive: stdin available");
  stdin.end();

  const { exitCode } = await handle.result;
  const stdout = await stdoutPromise;
  assert.equal(exitCode, 0, "docker interactive: exit code 0");
  assert.ok(stdout.includes("stdin-is-tty"), "docker interactive: stdin is tty");
  assert.ok(stdout.includes("stdout-is-tty"), "docker interactive: stdout is tty");
  console.log("✓ docker runner — tty contract");
}

async function main() {
  console.log("\n=== Host Runner ===\n");
  await verifyHostPiped();
  await verifyHostStdin();
  await verifyHostKill();
  await verifyHostAbort();
  await verifyHostInherit();
  await verifyHostExitCode();
  await verifyHostEnv();

  console.log("\n=== Docker Runner ===\n");
  const engine = resolveAvailableEngine();

  if (engine !== null) {
    await verifyDockerPiped(engine);
    await verifyDockerStdin(engine);
    await verifyDockerKill(engine);
    await verifyDockerExitCode(engine);
    await verifyDockerEnv(engine);
    await verifyDockerMount(engine);
    await verifyDockerPort(engine);
    await verifyDockerInteractiveContract(engine);
  } else {
    console.log("⏭ Docker not available — skipping docker runner tests");
  }

  console.log("\n=== All verifications passed ===\n");
}

async function readStream(stream: Readable | null, label: string): Promise<string> {
  const readable = assertReadable(stream, `${label}: stream is available`);

  return await new Promise<string>((resolve, reject) => {
    let output = "";
    readable.setEncoding("utf8");
    readable.on("data", (chunk: string) => {
      output += chunk;
    });
    readable.once("end", () => {
      resolve(output);
    });
    readable.once("error", reject);
  });
}

function assertReadable(stream: Readable | null, message: string): Readable {
  if (stream === null) {
    assert.fail(message);
  }

  return stream;
}

function assertWritable(stream: Writable | null, message: string): Writable {
  if (stream === null) {
    assert.fail(message);
  }

  return stream;
}

function resolveAvailableEngine(): Engine | null {
  for (const engine of ["docker", "podman"] as const) {
    if (!isEngineResponsive(engine, ["--version"])) {
      continue;
    }

    if (isEngineResponsive(engine, ["info"])) {
      return engine;
    }
  }

  return null;
}

function isEngineResponsive(engine: Engine, args: string[]): boolean {
  const result = spawnSync(engine, args, {
    stdio: "ignore",
    timeout: 2000
  });

  if (result.error !== undefined) {
    return false;
  }

  return result.status === 0;
}

async function waitForHttpOk(url: string): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15000) {
    try {
      const response = await fetch(url);
      const body = await response.text();

      if (response.ok && body.includes("ok")) {
        return;
      }
    } catch (error) {
      void error;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
