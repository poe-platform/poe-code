import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { moveTasks, openTaskList } from "../dist/index.js";

for (const type of ["markdown-dir", "yaml-file"]) {
  test(`SafeFS supports ${type} task lifecycle and dry-run migration`, async () => {
    const fs = new MemoryFileSystem();
    const options = { type, path: type === "yaml-file" ? "/tasks.yaml" : "/tasks", create: true, fs };
    const store = await openTaskList(options);
    const tasks = store.list("work");
    await tasks.create({ id: "review", name: "café 😀", description: "Unicode body", metadata: { owner: "QA" } });
    await tasks.fire("review", "plan");
    assert.equal((await tasks.get("review")).state, "planned");

    const target = { type, path: type === "yaml-file" ? "/target.yaml" : "/target", create: true, fs };
    assert.deepEqual(await moveTasks({ source: options, target, dryRun: true }), { created: 0, skipped: 1, errors: [] });
    await assert.rejects(fs.stat(target.path), { code: "ENOENT" });
    assert.deepEqual(await moveTasks({ source: options, target }), { created: 1, skipped: 0, errors: [] });
    const copied = await (await openTaskList(target)).list("work").get("review");
    assert.equal(copied.name, "café 😀");
    assert.equal(copied.description, "Unicode body");
    assert.equal(copied.metadata.owner, "QA");
    await tasks.delete("review");
    assert.deepEqual(await store.allTasks(), []);
  });
}
