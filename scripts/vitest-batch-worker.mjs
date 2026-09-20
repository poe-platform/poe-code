import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function runBatchFiles(root, files) {
  assert.ok(path.isAbsolute(root) && Array.isArray(files) && files.length && files.every(file => path.isAbsolute(file) && file.startsWith(path.resolve(root) + path.sep)), "Invalid unit batch selection");
  const expected = new Set(files);
  assert.equal(expected.size, files.length, "Duplicate unit batch selection");
  const { createVitest } = await import("vitest/node");
  const { default: ImmediateReporter } = await import("./vitest-immediate-reporter.mjs");
  const context = await createVitest("test", {
    root, config: path.join(root, "vitest.config.ts"), watch: false,
    reporters: [new ImmediateReporter({ summary: false }, true)], ...(process.env.CI ? {} : { maxWorkers: 1 })
  });
  const failures = [];
  let completed;
  try {
    assert.ok(context.config.isolate && context.config.poolOptions?.threads?.isolate !== false, "Unit batches require per-file isolation");
    assert.ok(!context.config.coverage.enabled && !context.config.globalSetup?.length, "Unit batches require the native isolated configuration");
    const selected = (await context.globTestSpecifications(files)).filter(specification => expected.has(specification.moduleId));
    assert.equal(selected.length, expected.size, "Unit batch selection changed");
    assert.deepEqual(new Set(selected.map(specification => specification.moduleId)), expected, "Unit batch selection changed");
    await context.standalone();
    const result = await context.runTestSpecifications(selected, false);
    assert.ok(!result.unhandledErrors.length && result.testModules.every(module => module.ok()) && !process.exitCode, "Unit batch tests failed");
    completed = result.testModules.map(module => module.moduleId);
    assert.equal(completed.length, files.length, "Unit batch did not complete every file");
    assert.deepEqual(new Set(completed), expected, "Unit batch completion changed");
  } catch (error) { failures.push(error); }
  finally { try { await context.close(); } catch (error) { failures.push(error); } }
  if (failures.length > 1) throw new AggregateError(failures, "Unit batch tests and cleanup failed");
  if (failures.length) throw failures[0];
  return completed;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  assert.ok(process.send, "Unit batch worker requires IPC");
  process.once("message", async message => {
    try {
      const files = await runBatchFiles(message.root, message.files);
      process.send({ ok: true, files });
    } catch (error) {
      process.send({ ok: false, error: error instanceof Error ? error.message : String(error) });
      process.exitCode = 1;
    } finally { process.disconnect(); }
  });
}
