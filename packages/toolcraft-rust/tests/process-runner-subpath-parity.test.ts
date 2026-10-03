import assert from "node:assert/strict";
import { it } from "vitest";
import type { Readable } from "node:stream";
import * as own from "@poe-code/process-runner-rust";

async function collect(stream: Readable | null): Promise<string> {
  assert.ok(stream);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

it("Native process-runner subpath exposes the reference namespace and own identities", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/process-runner"),
    import("toolcraft/process-runner")
  ]);
  assert.deepEqual(Object.keys(native).sort(), Object.keys(reference).sort());
  for (const name of Object.keys(reference)) assert.equal(native[name], own[name], name);
  for (const engine of ["docker", "podman"] as const) for (const context of [null, "", "colima-test"]) {
    assert.deepEqual(native.buildContextArgs(engine, context), reference.buildContextArgs(engine, context));
  }
});

it("Native process-runner subpath preserves mock streams, results and command lookup", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/process-runner"),
    import("toolcraft/process-runner")
  ]);
  const outcomes = [];
  for (const api of [reference, native]) {
    const runner = api.createMockRunner([{pid: 123, stdout: ["one", "😀"], stderr: ["warning"], stdoutInterval: 0, exitCode: 7}]);
    const handle = runner.exec({command: "mock", stdin: "pipe"});
    assert.ok(handle.stdin);
    handle.stdin.end("input");
    const [stdout, stderr, result] = await Promise.all([collect(handle.stdout), collect(handle.stderr), handle.result]);
    assert.equal(stdout, "one😀");
    assert.equal(stderr, "warning");
    assert.deepEqual(result, {exitCode: 7});
    const byCommand = api.createMockRunnerByCommand({known: {exitCode: 9}});
    const commandResult = await byCommand.exec({command: "known"}).result;
    assert.deepEqual(commandResult, {exitCode: 9});
    assert.throws(() => runner.exec({command: "exhausted"}));
    assert.throws(() => byCommand.exec({command: "missing"}));
    outcomes.push({name: runner.name, pid: handle.pid, stdout, stderr, result, commandResult});
  }
  assert.deepEqual(outcomes[1], outcomes[0]);
});

it("Native process-runner subpath retains pre-aborted handles and host environment capabilities", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/process-runner"),
    import("toolcraft/process-runner")
  ]);
  const outcomes = [];
  for (const api of [reference, native]) {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const handle = api.createHostRunner().exec({command: "must-not-run", signal: controller.signal});
    assert.equal(handle.pid, null);
    assert.equal(handle.stdin, null);
    assert.equal(handle.stdout, null);
    assert.equal(handle.stderr, null);
    assert.deepEqual(await handle.result, {exitCode: 1});
    handle.kill();
    const factory = api.hostExecutionEnvFactory;
    const env = await factory.open({cwd: "/work", runtime: {type: "host"}, env: {}, uploadIgnoreFiles: [], jobLabel: {tool: "test", argv: []}});
    const upload = await env.uploadWorkspace(), download = await env.downloadWorkspace({conflictPolicy: "refuse"});
    assert.deepEqual(upload, {files: 0, bytes: 0, skipped: []});
    assert.deepEqual(download, {files: 0, bytes: 0, conflicts: []});
    await assert.rejects(env.detach(), {message: "host runtime does not support detach because host has no addressable env"});
    await assert.rejects(factory.attach("missing"), {message: "host runtime does not support reattach"});
    await env.close();
    outcomes.push({type: factory.type, detach: factory.supportsDetach, transfer: factory.supportsWorkspaceTransfer, id: env.id, job: env.job, upload, download});
  }
  assert.deepEqual(outcomes[1], outcomes[0]);
});
