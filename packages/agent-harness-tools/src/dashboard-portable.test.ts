import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("drives an injected dashboard without a Node terminal", async () => {
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  const bundle = await build({ stdin: { contents: 'export { createHarnessDashboard } from "./harness-dashboard.ts"; export { createRunQueue } from "./run-queue.ts";', resolveDir: source(".") }, bundle: true, write: false,
    platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent",
    alias: { "#harness-tools-dashboard": source("./default-dashboard.workerd.ts") } });
  const runtime = runInNewContext(`${bundle.outputFiles[0].text}; runtime`, { Error, setInterval, clearInterval });
  const updates: unknown[] = [];
  let stopped = false;
  const view = runtime.createHarnessDashboard({ title: "Review", agent: "test", cwd: "/repo", queue: runtime.createRunQueue({ plans: ["review.md"], cwd: "/repo" }),
    dashboardFactory: () => ({ updateStats: (stats: unknown) => updates.push(stats), start() {}, stop() { stopped = true; }, destroy() {} }) });
  view.updateRun({ phase: "Reviewing" });
  expect(updates.at(-1)).toMatchObject({ currentAction: "Reviewing" });
  view.dispose();
  expect(stopped).toBe(true);
});
