import test from "node:test";
import assert from "node:assert/strict";
import { Volume, createFsFromVolume } from "memfs";
import { openTaskList, moveTasks } from "../dist/index.js";
test("migration preserves state paths and rolls back failed target creation", async () => {
  const volume = Volume.fromJSON({}, "/"),
    fs = createFsFromVolume(volume).promises;
  const source = await openTaskList({ type: "markdown-dir", path: "/source", fs, create: true });
  const tasks = source.list("work");
  await tasks.create({ id: "ship", name: "Ship", description: "body", metadata: { owner: "A" } });
  await tasks.fire("ship", "plan");
  await tasks.fire("ship", "start");
  await tasks.fire("ship", "complete");
  const events = [];
  const result = await moveTasks({
    source: { type: "markdown-dir", path: "/source", fs },
    target: { type: "yaml-file", path: "/target.yaml", fs, create: true },
    stateMap: { done: "done" },
    rate: 1000,
    onProgress: (event) => events.push(event.type)
  });
  assert.deepEqual(result, { created: 1, skipped: 0, errors: [] });
  assert.deepEqual(events, ["created"]);
  const target = await openTaskList({ type: "yaml-file", path: "/target.yaml", fs });
  assert.equal((await target.list("work").get("ship")).state, "done");
  const rejected = {
    initial: "draft",
    states: ["draft", "done"],
    events: { finish: { from: ["draft"], to: "done", guard: () => "denied" } }
  };
  const rollback = await moveTasks({
    source: { type: "markdown-dir", path: "/source", fs },
    target: { type: "yaml-file", path: "/rollback.yaml", fs, create: true, stateMachine: rejected },
    stateMap: { done: "done" },
    rate: 1000
  });
  assert.equal(rollback.created, 0);
  assert.equal(rollback.errors.length, 1);
  const rolled = await openTaskList({
    type: "yaml-file",
    path: "/rollback.yaml",
    fs,
    stateMachine: rejected
  });
  assert.deepEqual(await rolled.allTasks(), []);
});
