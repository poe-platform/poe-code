import test from "node:test";
import assert from "node:assert/strict";
import { Volume, createFsFromVolume } from "memfs";
import { openTaskList } from "../dist/open.js";
test("memfs Markdown create/fire/reorder/archive preserves metadata and body", async () => {
  const volume = Volume.fromJSON({}, "/"),
    fs = createFsFromVolume(volume).promises;
  const store = await openTaskList({ type: "markdown-dir", path: "/tasks", fs, create: true });
  const tasks = store.list("work");
  await tasks.create({
    id: "first",
    name: "First",
    description: "body\n",
    metadata: { owner: "A", created: "2026-01-01T00:00:00Z" }
  });
  await tasks.create({ id: "second", name: "Second", metadata: { nested: { value: 3 } } });
  await tasks.reorder(["second", "first"]);
  assert.deepEqual(
    (await tasks.all()).map((t) => t.id),
    ["second", "first"]
  );
  await tasks.fire("first", "plan");
  await tasks.fire("first", "start");
  await tasks.fire("first", "complete");
  await tasks.fire("first", "archive");
  const first = await tasks.get("first");
  assert.equal(first.description, "body\n");
  assert.equal(first.metadata.owner, "A");
  assert.deepEqual(
    (await tasks.all()).map((t) => t.id),
    ["second"]
  );
  assert.equal((await tasks.all({ includeArchived: true })).length, 2);
  const files = Object.keys(volume.toJSON());
  assert.ok(files.some((path) => path.endsWith("/archive/first.md")));
});
