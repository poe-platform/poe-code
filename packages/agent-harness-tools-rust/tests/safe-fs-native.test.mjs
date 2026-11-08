import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { archivePlan, discoverPlans, openPlanList, streamLogFile, waitForExit } from "../dist/index.js";

test("SafeFS plan discovery and archival use the embedded task backend", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/workspace/plans", { recursive: true });
  await fs.writeFile("/workspace/plans/01-review.md", new TextEncoder().encode("---\nkind: ralph\nname: café 😀\nstate: draft\nreadiness: ready\nnotes: preserved\n---\nReview."));
  const options = { cwd: "/workspace", homeDir: "/home/user", planDirectory: "plans", fs };
  const [plan] = await discoverPlans(options);
  assert.equal(plan.id, "review");
  assert.equal(plan.name, "café 😀");
  assert.equal(plan.readiness, "ready");
  assert.equal(plan.displayPath, "plans/01-review.md");
  assert.deepEqual(await (await openPlanList(options)).lists(), ["plans"]);
  const archived = await archivePlan({ ...options, id: "review", metadataPatch: { result: "complete" } });
  const text = new TextDecoder().decode(await fs.readFile(archived));
  assert.ok(text.includes("notes: preserved"));
  assert.ok(text.includes("result: complete"));
  assert.ok(text.includes("Review."));
  assert.deepEqual(await discoverPlans(options), []);
});

test("SafeFS job logs preserve UTF-8 byte offsets and exit status", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp/poe-jobs", { recursive: true });
  await fs.writeFile("/tmp/poe-jobs/review.log", new TextEncoder().encode("café 😀"));
  await fs.writeFile("/tmp/poe-jobs/review.exit", new TextEncoder().encode("23"));
  const chunks = [];
  for await (const chunk of streamLogFile({ fs }, "review", { sinceByte: 6, follow: false })) chunks.push(chunk);
  assert.deepEqual(chunks, [{ byteOffset: 6, data: "😀" }]);
  assert.deepEqual(await waitForExit({ fs }, "review"), { exitCode: 23 });
  await fs.symlink("/tmp/poe-jobs/review.log", "/tmp/poe-jobs/linked.log");
  await assert.rejects(streamLogFile({ fs }, "linked", { follow: false }).next(), /must not be a symbolic link/);
});
