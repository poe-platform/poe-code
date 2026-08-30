import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultNames } from "./recipes.mjs";

export async function inventory(sourceRoot, baselineRoot) {
  const library = await import(pathToFileURL(join(sourceRoot, "src/index.ts")).href);
  const baseline = await import(pathToFileURL(join(baselineRoot, "dist/bundle/index.js")).href);
  const runtime = await readFile(join(sourceRoot, "src/shell/runtime.ts"), "utf8");
  const declaration = runtime.match(/const shellBuiltinNames = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(declaration, "Review inventory extraction when runtime changes");
  const classified = [...declaration[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const kernel = classified.filter(name => !["echo", "printf", "test", "["].includes(name)).sort();
  const registered = library.createAgentCommands().map(command => command.name).sort();
  assert.deepEqual(registered, [...defaultNames].sort(), "Corpus default-name list must be reviewed after registration changes");
  const bundle = await readFile(join(baselineRoot, "dist/bundle/index.js"), "utf8");
  const builtinSet = [...bundle.matchAll(/new Set\(\[([^\]]{1,20000})\]\)/g)].find(match => match[1].includes('"cd"') && match[1].includes('"eval"'));
  assert.ok(builtinSet, "Pinned baseline builtin classifier not found");
  const dispatchPosition = bundle.indexOf('if(t==="cd")');
  assert.ok(dispatchPosition > 0, "Pinned baseline dispatcher not found");
  const dispatchBody = bundle.slice(bundle.lastIndexOf("async function ", dispatchPosition), bundle.indexOf("async function ", dispatchPosition));
  const baselineKernel = [...new Set([...dispatchBody.matchAll(/t==="([^"]+)"/g)].map(match => match[1]))].filter(name => !name.startsWith("__just_bash_")).sort();
  const baselineNames = baseline.getCommandNames().sort();
  assert.deepEqual([...new baseline.Bash().commands.keys()].sort(), baselineNames);
  const union = (...lists) => [...new Set(lists.flat())].sort();
  const ours = union(registered, kernel, ["bash", "sh"]), theirs = union(baselineNames, baselineKernel);
  return {
    virtual: { registered, classified, kernel, interpreterEntrypoints: ["bash", "sh"], union: ours, optional: ["curl", "safejs"],
      shadowedRegistry: registered.filter(name => kernel.includes(name)), unshadowedRegistry: registered.filter(name => !kernel.includes(name)) },
    baseline: { registered: baselineNames, classified: JSON.parse(`[${builtinSet[1]}]`).sort(), kernel: baselineKernel, union: theirs,
      optional: { network: baseline.getNetworkCommandNames(), python: baseline.getPythonCommandNames(), javascript: baseline.getJavaScriptCommandNames() } },
    baselineOnlyNames: theirs.filter(name => !ours.includes(name)), virtualOnlyNames: ours.filter(name => !theirs.includes(name)),
    caveat: "Registered names, aliases, classifier recognition and kernel dispatch are distinct; none establishes complete semantics. Kernel coverage is declared recipes plus virtual middleware events; baseline has no equivalent public kernel trace. Version-specific private registry wrapping is verified with uninstrumented controls.",
  };
}
