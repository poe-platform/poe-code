import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "toolcraft-rust/human-in-loop";
import * as reference from "toolcraft/human-in-loop";
import { defineCommand, defineGroup, S } from "../dist/index.js";
import { createSDK } from "toolcraft-rust/sdk";
import { openTaskList } from "@poe-code/task-list-rust";
import { createFsFromVolume, Volume } from "memfs";

test("public human-in-loop exports match the reference and default providers stay lazy", () => {
  assert.deepEqual(Object.keys(native).sort(), Object.keys(reference).sort());
  assert.equal(native.defaultProviderForPlatform(), native.defaultProviderForPlatform());
  assert.equal(native.defaultProviderForPlatform().id, process.platform === "darwin" ? "osascript" : "noProviderConfigured");
});

test("public approval runtime composes with native SDK and in-memory native task storage", async () => {
  const taskList = await openTaskList({ type: "yaml-file", path: "/approvals.yaml", create: true,
    fs: createFsFromVolume(new Volume()).promises, stateMachine: native.approvalStateMachine });
  const calls = [];
  const provider = { id: "test", async requestApproval(request) { calls.push(request); return { outcome: "approved" }; } };
  const humanInLoop = native.createHumanInLoop({ provider, taskList });
  const command = defineCommand({ name: "deploy", params: S.Object({ revision: S.Number() }),
    humanInLoop: { mode: "sync", message: () => "Deploy?" }, handler: ctx => ctx.params.revision });
  const root = defineGroup({ name: "app", children: [command] });
  const sdk = createSDK(root, { humanInLoop, approvals: true });
  assert.equal(await sdk.deploy({ revision: 42 }), 42);
  assert.deepEqual(calls, [{ message: "Deploy?", declineInputPrompt: undefined }]);
  assert.deepEqual(await sdk.approvals.list({}), []);
  const queued = { ...command, humanInLoop: { ...command.humanInLoop, mode: "async" } };
  const pending = await native.invokeWithHumanInLoop(queued, { params: { revision: 43 } }, humanInLoop.runtimeOptions, "deploy", { spawnRunner: false });
  const listed = await sdk.approvals.list({ state: ["pending", "pending"] });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, pending.approvalId);
  assert.equal((await sdk.approvals.show({ approvalId: pending.approvalId })).state, "pending");
  assert.equal(Object.hasOwn(sdk.approvals, "run"), false);
});
