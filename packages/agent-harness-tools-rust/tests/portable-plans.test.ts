import { expect, it } from "vitest";
import { MemoryFileSystem } from "../../safe-fs/src/core.js";
import { archivePlan, discoverPlans, openPlanList } from "../dist/plans.js";
import { openTaskList } from "../dist/tasks/index.js";
import { streamLogFile, waitForExit } from "../dist/log-stream.js";

it("discovers and archives Unicode plans through a portable filesystem", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/plans", { recursive: true });
  await fs.writeFile("/repo/plans/portable.md", new TextEncoder().encode("---\nname: café 😀\nreadiness: ready\n---\nUnicode body\n"));
  const options = { cwd: "/repo", homeDir: "/home/test", planDirectory: "plans", fs };
  expect(await discoverPlans(options)).toMatchObject([{ id: "portable", name: "café 😀" }]);
  const tasks = await openPlanList(options);
  expect((await tasks.list("plans").get("portable")).description).toContain("Unicode body");
  const archived = await archivePlan({ ...options, id: "portable" });
  expect(new TextDecoder().decode(await fs.readFile(archived))).toContain("café 😀");
  expect(await discoverPlans(options)).toEqual([]);
});

it.each(["markdown-dir", "yaml-file"] as const)("manages %s tasks with portable byte reads and writes", async type => {
  const fs = new MemoryFileSystem();
  const tasks = await openTaskList({ type, path: type === "yaml-file" ? "/tasks.yaml" : "/tasks", create: true, fs });
  const list = tasks.list("work");
  await list.create({ id: "portable", name: "café 😀", description: "Unicode body" });
  expect(await tasks.allTasks()).toMatchObject([{ id: "portable", name: "café 😀" }]);
  await list.delete("portable");
  expect(await tasks.allTasks()).toEqual([]);
});

it("reads Unicode job logs and exit status from a portable filesystem", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp/poe-jobs", { recursive: true });
  await fs.writeFile("/tmp/poe-jobs/portable.log", new TextEncoder().encode("café 😀\n"));
  await fs.writeFile("/tmp/poe-jobs/portable.exit", new TextEncoder().encode("7"));
  const chunks = [];
  for await (const chunk of streamLogFile({ fs }, "portable", { follow: false })) chunks.push(chunk);
  expect(chunks).toEqual([{ byteOffset: 0, data: "café 😀\n" }]);
  expect(await waitForExit({ fs }, "portable")).toEqual({ exitCode: 7 });
});
