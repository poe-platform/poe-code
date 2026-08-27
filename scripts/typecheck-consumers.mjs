import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { consumerGroups, currentSourceConsumerGroups, negativeGroups, ownerPath } from "../tests/plugins/qualified-current-release/consumers.mjs";
import { validateRuntimeCoverage } from "../tests/plugins/qualified-current-release/runtime-coverage.mjs";

export function assertBuiltConsumerResolution(stdout, consumer, root) {
  assert.ok(stdout.includes(`${consumer}/`) && stdout.includes("node_modules/virtual-bash/dist/"), "consumer must resolve the copied built package");
  assert.ok(!stdout.includes(`was successfully resolved to '${join(root, "src")}/`), "public consumer used repository source fallback");
}

export function checkSourceConsumerTypes(root, temporary, compile) {
  const groups = currentSourceConsumerGroups.map(group => {
    const result = { name: group.name, files: group.files, qualification: group.qualification, status: "pending", runtime: "not executed: typecheck-only route" };
    try {
      const filename = join(temporary, `${group.name}.json`);
      writeFileSync(filename, JSON.stringify({
        extends: join(root, "tsconfig.json"),
        compilerOptions: { noEmit: true, skipLibCheck: false, typeRoots: [join(root, "node_modules/@types")] },
        files: group.files.map(path => join(root, path)), include: [], exclude: [],
      }));
      const checked = compile(`source-consumer-${group.name}`, ["-p", filename, "--traceResolution"]);
      assert.equal(checked.status, 0, `strict current source consumer failed: ${group.name}`);
      const publicResolutions = [...checked.stdout.matchAll(/Module name 'virtual-bash(?:\/[^']*)?' was successfully resolved to '([^']+)'/gu)];
      assert.ok(publicResolutions.length > 0, "current source consumer must resolve public package declarations");
      for (const resolution of publicResolutions) assert.ok(resolution[1].startsWith(`${join(root, "dist")}/`), "public imports must use the candidate build, not source fallback");
      result.status = "pass";
    } catch (error) { result.status = "fail"; result.error = error.message; }
    return result;
  });
  return { groups, passed: groups.every(group => group.status === "pass"), qualification: "Exact current .ts public consumers; explicit source fixture helpers are retained. Not isolated packed runtime or provider acceptance." };
}

export function checkCurrentConsumerTypes(root, temporary, compile) {
  validateRuntimeCoverage(consumerGroups);
  const consumer = join(temporary, "consumer"), installed = join(consumer, "node_modules/virtual-bash");
  mkdirSync(installed, { recursive: true });
  cpSync(join(root, "package.json"), join(installed, "package.json"));
  cpSync(join(root, "dist"), join(installed, "dist"), { recursive: true });
  assert.equal(existsSync(join(installed, "src")), false);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const groups = [], negativeTypes = [];
  for (const group of consumerGroups) {
    const result = { name: group.name, files: group.files, status: "pending", runtime: "not executed: typecheck-only route" };
    groups.push(result);
    try {
      const workspace = join(consumer, group.name); mkdirSync(workspace);
      if (group.localPackage) cpSync(installed, join(workspace, "node_modules/virtual-bash"), { recursive: true });
      const inputs = [...group.files, ...group.companions ?? []].map((path, index) => {
        const name = index < group.files.length ? basename(path) : group.companionNames?.[index - group.files.length] ?? basename(path);
        const target = join(workspace, name); assert.equal(existsSync(target), false, "consumer basename collision");
        cpSync(join(root, path), target); assert.deepEqual(readFileSync(target), readFileSync(join(root, path)));
        return target;
      });
      const config = JSON.parse(readFileSync(join(root, ownerPath, "tsconfig.consumer.json")));
      Object.assign(config.compilerOptions, { noEmit: true, rootDir: workspace, typeRoots: [join(root, "node_modules/@types")] });
      config.files = inputs;
      const filename = join(workspace, "tsconfig.json"); writeFileSync(filename, JSON.stringify(config));
      const resolution = compile(`consumer-${group.name}`, ["-p", filename, "--traceResolution"]);
      assert.equal(resolution.status, 0, `strict consumer declarations failed: ${group.name}`);
      assertBuiltConsumerResolution(resolution.stdout, consumer, root);
      result.status = "pass";
    } catch (error) { result.status = "fail"; result.error = error.message; }
  }
  for (const group of negativeGroups) {
    const result = { name: group.name, status: "pending", diagnostics: group.diagnostics }; negativeTypes.push(result);
    try {
      assert.equal(groups.find(positive => positive.name === group.positive)?.status, "pass", "positive consumer must pass first");
      const workspace = join(consumer, group.positive), input = join(workspace, basename(group.path));
      cpSync(join(root, group.path), input);
      const config = JSON.parse(readFileSync(join(workspace, "tsconfig.json"))); config.files = [input];
      const filename = join(workspace, "negative.json"); writeFileSync(filename, JSON.stringify(config));
      const checked = compile(`negative-${group.name}`, ["-p", filename]);
      assert.equal(checked.status, 2); assert.equal(checked.stderr, "");
      const diagnosticName = basename(group.path).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const normalized = checked.stdout.replaceAll(new RegExp(`^.*?(${diagnosticName}\\()`, "gmu"), "$1");
      assert.equal(normalized, readFileSync(join(root, group.expected), "utf8"), "exact negative diagnostics changed");
      assert.equal([...normalized.matchAll(/error TS\d+:/gu)].length, group.diagnostics);
      result.status = "pass";
    } catch (error) { result.status = "fail"; result.error = error.message; }
  }
  return { scope: "Existing maintained consumer routes; strict types and exact diagnostic negatives only. Zero runtime executions, no provider acceptance.", groups, negativeTypes,
    passed: groups.every(group => group.status === "pass") && negativeTypes.every(group => group.status === "pass") };
}
