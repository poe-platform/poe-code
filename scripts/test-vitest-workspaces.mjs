import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceUnitSelections } from "./workspace-test-ownership.mjs";

export function sharedVitestStages(plan, fileSystem = fs) {
  const scripts = plan.rootManifest.scripts;
  if (plan.testArguments.length ||
      scripts["test:unit"] !== "vitest run --config vitest.root.config.ts" ||
      scripts["test:unit:shared"] !== "node scripts/test-vitest-workspaces.mjs" ||
      ["pretest:unit", "posttest:unit", "pretest:unit:shared", "posttest:unit:shared"].some(event => scripts[event] !== undefined)) {
    return plan.testStages;
  }
  const selections = new Map(workspaceUnitSelections(plan.root, fileSystem)
    .filter(selection => !selection.hasHooks && !selection.requiresNativePool).map(selection => [selection.path, selection]));
  const compatible = plan.testStages.filter(stage => stage.path === null || selections.has(stage.path));
  if (compatible.length < 2) return plan.testStages;
  const root = compatible.find(stage => stage.path === null)
    ?? (plan.ciGroup ? { ...compatible[0], id: "//#test:unit", name: plan.rootManifest.name, path: null } : undefined);
  if (!root) return plan.testStages;
  const shared = {
    ...root,
    event: "test:unit:shared",
    testArguments: [...(plan.ciGroup ? [`--ci-group=${plan.ciGroup}`] : []), ...(plan.affected ? [`--affected=${plan.affected}`] : []), ...compatible.map(stage => stage.path ?? ".")],
    phases: compatible.map(stage => ({
      name: stage.name,
      path: stage.path,
      selectors: selections.get(stage.path)?.selectors ?? [],
      passWithNoTests: selections.get(stage.path)?.passWithNoTests ?? false,
      ...(({ ...plan.configuration?.tasks?.["test:unit"], ...plan.configuration?.tasks?.[stage.name + "#test:unit"] }).cache === false ? { cache: false } : {})
    }))
  };
  return [shared, ...plan.testStages.filter(stage => !compatible.includes(stage))];
}

export async function runSharedVitest(root, phases, { cacheStore, fingerprints, cache = false, cacheFiles, batchSize = 100, runBatch } = {}) {
  assert.ok(Number.isSafeInteger(batchSize) && batchSize > 0, "Invalid Vitest batch size");
  const environment = { TEST: process.env.TEST, VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV };
  const contexts = [];
  const failures = [];
  const pendingRecords = [];
  let revalidateFingerprints;
  const cacheStats = { cacheHits: 0, cacheMisses: 0, fingerprintMs: 0 };
  process.env.TEST = "true";
  process.env.VITEST = "true";
  process.env.NODE_ENV ??= "test";
  try {
    const { createVitest } = await import("vitest/node");
    const { default: ImmediateReporter } = await import("./vitest-immediate-reporter.mjs");
    const discovery = await createVitest("test", {
      root, config: path.join(root, "vitest.root.config.ts"), watch: false, reporters: []
    });
    contexts.push(discovery);
    const rootSpecifications = await discovery.globTestSpecifications();
    const rootFiles = new Set(rootSpecifications.map(specification => specification.moduleId));
    assert.equal(rootFiles.size, rootSpecifications.length, "Multiple root specifications per file are unsupported");
    rootSpecifications.length = 0;
    contexts.pop();
    await discovery.close();
    const reporter = new ImmediateReporter({ summary: false }, true);
    let context = await createVitest("test", {
      root, config: path.join(root, "vitest.config.ts"), watch: false, reporters: [reporter], ...(process.env.CI ? {} : { maxWorkers: 1 })
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
    const { createCheckCache, createTaskFingerprints, taskCacheKey } = await import("./check-cache.mjs");
    if (cache && !cacheStore) {
      cacheStore = createCheckCache();
      const { createWorkspaceBuildPlan } = await import("./build-workspaces.mjs");
      const started = performance.now();
      const fingerprintPlan = createWorkspaceBuildPlan(root);
      const fingerprintOptions = { files: cacheFiles, environment: { ...process.env }, selected: phases.filter(phase => phase.path !== null).map(phase => phase.name) };
      fingerprints = createTaskFingerprints(fingerprintPlan, fingerprintOptions);
      revalidateFingerprints = () => createTaskFingerprints(fingerprintPlan, fingerprintOptions);
      cacheStats.fingerprintMs = Math.round(performance.now() - started);
    }
    for (const phase of phases) {
      const selected = phase.path === null
        ? [...rootFiles].map(filename => byPath.get(filename))
        : await context.globTestSpecifications(phase.selectors);
      assert.ok(selected.length || phase.passWithNoTests, `No test files: ${phase.name}`);
      for (const specification of selected) {
        assert.ok(!scheduled.has(specification.moduleId), `Unit test ownership overlap: ${specification.moduleId}`);
        scheduled.add(specification.moduleId);
      }
      const key = phase.cache !== false && phase.path !== null && fingerprints?.has(phase.name)
        ? taskCacheKey(fingerprints.get(phase.name), "test:unit", phase.selectors) : undefined;
      const files = selected.map(specification => path.relative(root, specification.moduleId)).sort();
      const record = key && cacheStore?.read(key);
      const cached = record?.success === true && JSON.stringify(record.files) === JSON.stringify(files);
      if (key) cacheStats[cached ? "cacheHits" : "cacheMisses"]++;
      groups.push({ phase, specifications: selected.map(specification => ({ moduleId: specification.moduleId })), key, files, cached });
    }
    byPath.clear();
    specifications.length = 0;
    await context.standalone();
    for (const group of groups) {
      if (group.cached) {
        console.log(`Unit workspace ${group.phase.name}: cached ${group.specifications.length} files`);
        continue;
      }
      if (!group.specifications.length) {
        console.log(`Unit workspace ${group.phase.name}: no test files (explicitly allowed)`);
        continue;
      }
      console.log(`Unit workspace ${group.phase.name}: running ${group.specifications.length} files`);
    }
    const queue = groups.filter(group => !group.cached).flatMap(group => group.specifications);
    if (queue.length) {
      const completed = new Set();
      for (let offset = 0; offset < queue.length; offset += batchSize) {
        let batch = queue.slice(offset, offset + batchSize);
        if (runBatch) {
          if (!offset) {
            contexts.pop();
            await context.close();
          }
          const ids = batch.map(specification => specification.moduleId);
          const result = await runBatch(root, ids);
          assert.equal(result.length, ids.length, "Unit batch completion changed");
          assert.deepEqual(new Set(result), new Set(ids), "Unit batch completion changed");
          for (const id of result) completed.add(id);
          continue;
        }
        if (offset) {
          contexts.pop();
          await context.close();
          context = await createVitest("test", {
            root, config: path.join(root, "vitest.config.ts"), watch: false,
            reporters: [new ImmediateReporter({ summary: false }, true)], ...(process.env.CI ? {} : { maxWorkers: 1 })
          });
          contexts.push(context);
          assert.ok(context.config.isolate && context.config.poolOptions?.threads?.isolate !== false,
            "Shared unit tests require per-file isolation");
          assert.ok(!context.config.coverage.enabled && !context.config.globalSetup?.length,
            "Shared unit batches require the native isolated configuration");
          await context.standalone();
        }
        const expected = new Set(batch.map(specification => specification.moduleId));
        batch = (await context.globTestSpecifications([...expected])).filter(specification => expected.has(specification.moduleId));
        assert.deepEqual(new Set(batch.map(specification => specification.moduleId)), expected,
          "Unit test selection changed between batches");
        const result = await context.runTestSpecifications(batch, false);
        if (result.unhandledErrors.length || result.testModules.some(module => !module.ok()) || process.exitCode) {
          throw new Error("Shared unit tests failed; see failed file reports above");
        }
        for (const module of result.testModules) completed.add(module.moduleId);
      }
      for (const group of groups) if (group.key && !group.cached && group.specifications.every(specification => completed.has(specification.moduleId))) {
        pendingRecords.push({ name: group.phase.name, selectors: group.phase.selectors, key: group.key, value: { success: true, files: group.files } });
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
  if (pendingRecords.length) {
    const started = performance.now();
    const current = revalidateFingerprints ? revalidateFingerprints() : fingerprints;
    if (revalidateFingerprints) cacheStats.fingerprintMs += Math.round(performance.now() - started);
    const { taskCacheKey } = await import("./check-cache.mjs");
    for (const record of pendingRecords) {
      if (current.has(record.name) && taskCacheKey(current.get(record.name), "test:unit", record.selectors) === record.key) cacheStore.write(record.key, record.value);
    }
  }
  if (cacheStore) console.log(JSON.stringify({ unitCache: "SHARED", ...cacheStats }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { createWorkspaceTestPlan } = await import("./build-workspaces.mjs");
    const root = fileURLToPath(new URL("../", import.meta.url));
    const expected = process.argv.slice(2);
    const groupArgument = expected[0]?.startsWith("--ci-group=") ? expected.shift() : undefined;
    const affectedArgument = expected[0]?.startsWith("--affected=") ? expected.shift() : undefined;
    const plan = createWorkspaceTestPlan(root, { affected: affectedArgument?.slice("--affected=".length), ciGroup: groupArgument?.slice("--ci-group=".length) });
    const shared = sharedVitestStages(plan).find(stage => stage.event === "test:unit:shared");
    assert.ok(shared, "Shared Vitest is not enabled for this workspace configuration");
    if (expected.length) assert.deepEqual(shared.testArguments, [...(groupArgument ? [groupArgument] : []), ...(affectedArgument ? [affectedArgument] : []), ...expected], "Workspace unit selection changed before shared execution");
    const { runVitestBatch } = await import("./run-vitest-batch.mjs");
    await runSharedVitest(root, shared.phases, {
      runBatch: runVitestBatch,
      cache: process.env.POE_CHECK_CACHE !== "0" && plan.ciGroup !== "fresh" && process.env.TURBO_FORCE !== "true"
        && (process.env.POE_SNAPSHOT_MODE ?? "playback") === "playback" && (process.env.POE_SNAPSHOT_MISS ?? "error") === "error"
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
