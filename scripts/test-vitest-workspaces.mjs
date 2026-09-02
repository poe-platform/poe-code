import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceUnitSelections } from "./workspace-test-ownership.mjs";

export function sharedVitestStages(plan, fileSystem = fs) {
  const scripts = plan.rootManifest.scripts;
  if (plan.concurrency !== 1 || plan.testArguments.length ||
      scripts["test:unit"] !== "vitest run --config vitest.root.config.ts" ||
      scripts["test:unit:shared"] !== "node scripts/test-vitest-workspaces.mjs" ||
      ["pretest:unit", "posttest:unit", "pretest:unit:shared", "posttest:unit:shared"].some(event => scripts[event] !== undefined)) {
    return plan.testStages;
  }
  const selections = new Map(workspaceUnitSelections(plan.root, fileSystem)
    .filter(selection => !selection.hasHooks).map(selection => [selection.path, selection]));
  const compatible = plan.testStages.filter(stage => stage.path === null || selections.has(stage.path));
  const root = compatible.find(stage => stage.path === null);
  if (!root || compatible.length < 2) return plan.testStages;
  const shared = {
    ...root,
    event: "test:unit:shared",
    testArguments: compatible.map(stage => stage.path ?? "."),
    phases: compatible.map(stage => ({
      name: stage.name,
      path: stage.path,
      selectors: selections.get(stage.path)?.selectors ?? [],
      passWithNoTests: selections.get(stage.path)?.passWithNoTests ?? false
    }))
  };
  return [shared, ...plan.testStages.filter(stage => !compatible.includes(stage))];
}

export async function runSharedVitest(root, phases) {
  const environment = { TEST: process.env.TEST, VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV };
  const contexts = [];
  const failures = [];
  process.env.TEST = "true";
  process.env.VITEST = "true";
  process.env.NODE_ENV ??= "test";
  try {
    const { createVitest } = await import("vitest/node");
    const { DefaultReporter } = await import("vitest/reporters");
    class WorkspaceReporter extends DefaultReporter {
      phasesRemaining = 0;
      constructor() {
        super({ summary: false });
      }
      printTestModule(module) {
        if (module.state() === "failed") super.printTestModule(module);
      }
      onFinished(files, errors = []) {
        this.phasesRemaining--;
        const snapshots = this.ctx.snapshot.summary;
        const snapshotNotice = ["added", "unmatched", "updated", "filesRemoved", "unchecked"].some(key => snapshots[key]) || snapshots.filesRemovedList?.length;
        if (this.phasesRemaining === 0 || errors.length || snapshotNotice || files.some(file => file.result?.state === "fail")) {
          super.onFinished(this.ctx.state.getFiles(), errors);
        }
      }
    }
    const discovery = await createVitest("test", {
      root, config: path.join(root, "vitest.root.config.ts"), watch: false, reporters: []
    });
    contexts.push(discovery);
    const rootSpecifications = await discovery.globTestSpecifications();
    const rootFiles = new Set(rootSpecifications.map(specification => specification.moduleId));
    assert.equal(rootFiles.size, rootSpecifications.length, "Multiple root specifications per file are unsupported");
    contexts.pop();
    await discovery.close();
    const reporter = new WorkspaceReporter();
    const context = await createVitest("test", {
      root, config: path.join(root, "vitest.config.ts"), watch: false, reporters: [reporter]
    });
    contexts.push(context);
    assert.ok(context.config.isolate && context.config.poolOptions?.threads?.isolate !== false,
      "Shared unit tests require per-file isolation");
    assert.ok(!context.config.coverage.enabled, "Shared unit tests do not support coverage; use the native workspace command");
    assert.ok(!context.config.globalSetup?.length, "Shared unit tests do not absorb workspace global setup");
    const specifications = await context.globTestSpecifications();
    const byPath = new Map(specifications.map(specification => [specification.moduleId, specification]));
    assert.equal(byPath.size, specifications.length, "Multiple shared specifications per file are unsupported");
    for (const filename of rootFiles) assert.ok(byPath.has(filename), `Root test file absent from shared configuration: ${filename}`);
    const scheduled = new Set();
    const groups = [];
    for (const phase of phases) {
      const selected = phase.path === null
        ? [...rootFiles].map(filename => byPath.get(filename))
        : await context.globTestSpecifications(phase.selectors);
      assert.ok(selected.length || phase.passWithNoTests, `No test files: ${phase.name}`);
      for (const specification of selected) {
        assert.ok(!scheduled.has(specification.moduleId), `Unit test ownership overlap: ${specification.moduleId}`);
        scheduled.add(specification.moduleId);
      }
      groups.push({ phase, specifications: selected });
    }
    reporter.phasesRemaining = groups.filter(group => group.specifications.length).length;
    await context.init();
    for (const group of groups) {
      if (!group.specifications.length) {
        console.log(`Unit workspace ${group.phase.name}: no test files (explicitly allowed)`);
        continue;
      }
      console.log(`Unit workspace ${group.phase.name}: running ${group.specifications.length} files`);
      const result = await context.runTestSpecifications(group.specifications, false);
      if (result.unhandledErrors.length || result.testModules.some(module => !module.ok()) || process.exitCode) {
        throw new Error(`Unit tests failed in workspace: ${group.phase.name}`);
      }
    }
  } catch (error) {
    failures.push(error);
  } finally {
    for (const context of contexts.reverse()) {
      try { await context.close(); } catch (error) { failures.push(error); }
    }
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  if (failures.length > 1) throw new AggregateError(failures, "Shared unit tests and cleanup failed");
  if (failures.length) throw failures[0];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { createWorkspaceTestPlan } = await import("./build-workspaces.mjs");
    const root = fileURLToPath(new URL("../", import.meta.url));
    const plan = createWorkspaceTestPlan(root);
    const shared = sharedVitestStages(plan).find(stage => stage.event === "test:unit:shared");
    assert.ok(shared, "Shared Vitest is not enabled for this workspace configuration");
    const expected = process.argv.slice(2);
    if (expected.length) assert.deepEqual(shared.testArguments, expected, "Workspace unit selection changed before shared execution");
    await runSharedVitest(root, shared.phases);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
