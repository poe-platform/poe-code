import assert from "node:assert/strict";
import { cases as prepared, environment, budgets, networkFixture } from "./cases.mjs";

export { environment, budgets, networkFixture };
export const cases = structuredClone(prepared);
const select = id => cases.find(specimen => specimen.id === id);
Object.assign(select("unalias-positive"), {
  script: "alias echo='printf alias-active' && shopt -s expand_aliases && eval 'echo' && unalias echo && eval 'echo restored'",
  intent: "Demonstrate alias expansion before removal, then restored echo dispatch after unalias.",
  prerequisites: ["alias", "shopt", "eval"],
});
select("unalias-positive").expected.stdoutBase64 = Buffer.from("alias-activerestored\n").toString("base64");
Object.assign(select("hash-positive"), {
  intent: "Store and retrieve a hash map entry; final echo is only a shared dispatch control.",
  proofLimit: "No claim that dispatch consulted the stored map; no PATH-cache or speed proof.",
});
select("terminal-byte-control").script = "printf '\\000\\177\\200\\377' > bytes && cat bytes";
select("sleep-positive").proofLimit = "Only product exec is timed; constructor, fixture, loader and process setup are excluded. Lower bound is loose sanity, not timer accuracy or performance.";
select("node-positive").operationalCredit = false;
for (const name of ["compopt", "dirs", "popd"]) select(`${name}-positive`).prerequisites = [name === "compopt" ? "complete" : "pushd"];
cases.push({
  ...structuredClone(select("printf-positive")),
  id: "vfs-census-control",
  script: "printf '%s' census-ok > control-output && cat control-link",
  targetArgv: null,
  files: { "control-file": { base64: Buffer.from("linked\n").toString("base64"), mode: 0o600 } },
  symlinks: { "control-link": "control-file" },
  intent: "Validate independent lstat/type/mode/symlink/content census and preservation around real printf/cat execution.",
  expected: { exitCode: 0, stdoutBase64: Buffer.from("linked\n").toString("base64"), stderrBase64: "", files: { "control-output": { base64: Buffer.from("census-ok").toString("base64") } }, absent: [], preserveInputs: true },
});
export const diagnostics = [
  ["compopt", "compopt -o nospace deploy", "complete may prevent reaching compopt"],
  ["dirs", "dirs -p", "pushd may prevent reaching dirs"],
  ["popd", "popd", "pushd may prevent reaching popd"],
  ["unalias", "unalias echo", "alias/shopt may prevent reaching unalias"],
  ["wait", "wait", "background syntax may prevent reaching wait"],
].map(([name, script, reason]) => ({
  ...structuredClone(select(`${name}-positive`)),
  id: `${name}-direct-diagnostic`, cohort: "direct-diagnostic", script,
  prerequisites: [], files: {}, directories: [], symlinks: {},
  expected: null, operationalCredit: false,
  intent: `Direct target reachability only: ${reason}. No help-only or positive functionality credit.`,
}));
assert.equal(cases.length, 61);
assert.equal(diagnostics.length, 5);
export const delta = {
  preservedPreparationRecipes: 60, primaryRecipes: 61, diagnosticRecipes: 5,
  perEngineAttempts: 66, totalEngineAttempts: 132,
  corrections: ["unalias-positive distinguishing expansion before/after removal", "hash-positive map-only claim", "terminal-byte-control preserves printf status with &&", "sleep-positive product-exec-only timing", "node-positive explicit no operational credit"],
  addedControl: "vfs-census-control", diagnosticPolicy: "All five predeclared diagnostics run on both engines, even if prerequisites succeeded; never inflate positive primary counts.",
};
