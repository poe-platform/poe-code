import assert from "node:assert/strict";
import test from "node:test";
import { cwd, instrument, invoke, memory, snapshot } from "../safety/helpers.js";
import { metadataProbes } from "./fixtures.js";

for (const kind of ["traversal", "symlink", "hardlink"] as const) test(`interstitial metadata cannot hide selected ${kind} from whole-input authorization`, async () => {
  const probe = metadataProbes.find(item => item.id === "metadata between-sections: rename from target")!;
  const backing = await memory({ first: "old\n", target: "old\n", sentinel: "untouched\n" });
  await backing.writeFile("/sandbox/sentinel", Buffer.from("outside sentinel\n"));
  if (kind === "symlink") await backing.symlink("target", `${cwd}/alias`);
  if (kind === "hardlink") await backing.link(`${cwd}/target`, `${cwd}/alias`);
  const path = kind === "traversal" ? "a/../sentinel" : "a/alias";
  const input = probe.input.replaceAll("--- a/target", `--- ${path}`).replaceAll("+++ a/target", `+++ ${path}`);
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { args: ["-p1"], input });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.deepEqual(observed.mutations(), [], "authorization must see the selected tail before publishing the prefix");
  assert.equal(result.stdout, "");
  assert.deepEqual(await snapshot(backing), before);
});
