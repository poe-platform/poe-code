import assert from "node:assert/strict";

export const families = Object.freeze({
  aliases: ["grepAliasCommands", "createGrepAliasCommands", "egrepCommand", "fgrepCommand"],
  column: ["columnCommands", "createColumnCommands", "createColumnCommand"],
});

export function validateDeclaration(value) {
  assert.deepEqual(Object.keys(value).sort(), ["agentOptions", "candidateCommit", "declaredBy", "fixtureCommit", "packageExports", "surfaces"].sort());
  assert.match(value.candidateCommit, /^[a-f0-9]{40}$/);
  assert.match(value.fixtureCommit, /^[a-f0-9]{40}$/);
  assert.equal(typeof value.declaredBy, "string");
  assert.ok(value.declaredBy.trim());
  assert.deepEqual(Object.keys(value.surfaces).sort(), ["aliases", "column"]);
  for (const surface of Object.values(value.surfaces)) {
    assert.deepEqual(Object.keys(surface).sort(), ["root", "subpath"]);
    assert.equal(surface.root, true, "root function exports are required");
    assert.ok(surface.subpath === null || /^virtual-bash\/[a-z0-9/-]+$/.test(surface.subpath));
    assert.ok(surface.root || surface.subpath !== null, "each complete family must be publicly exported");
  }
  assert.deepEqual(Object.keys(value.agentOptions).sort(), ["column", "regex"]);
  for (const path of Object.values(value.agentOptions)) {
    assert.ok(Array.isArray(path) && path.length > 0 && path.length < 5);
    for (const name of path) {
      assert.match(name, /^[a-zA-Z][a-zA-Z0-9]*$/);
      assert.ok(!["constructor", "prototype"].includes(name));
    }
  }
  assert.ok(value.packageExports && typeof value.packageExports === "object" && !Array.isArray(value.packageExports));
  assert.ok(Object.hasOwn(value.packageExports, "."));
  validateExportTarget(value.packageExports["."]);
  for (const surface of Object.values(value.surfaces)) {
    if (surface.subpath) {
      const key = surface.subpath.replace("virtual-bash/", "./");
      assert.ok(Object.hasOwn(value.packageExports, key), "declared subpaths require literal export keys; wildcard binding needs clarification");
      validateExportTarget(value.packageExports[key]);
    }
  }
  return value;
}

function validateExportTarget(target) {
  if (typeof target === "string") {
    assert.ok(target.startsWith("./") && target.length > 2 && !/[\\%?#*]/.test(target), "export target must name a package-local file");
    assert.ok(target.slice(2).split("/").every(segment => segment && ![".", "..", "node_modules"].includes(segment)));
    return;
  }
  assert.ok(target && typeof target === "object", "declared export cannot be disabled");
  assert.ok(Object.keys(target).length > 0, "declared export cannot be empty");
  for (const nested of Object.values(target)) validateExportTarget(nested);
}

export function nestedOption(path, value) {
  return path.reduceRight((nested, name) => ({ [name]: nested }), value);
}

export function specifiers(configuration, family) {
  if (configuration.mode === "baseline") return [`./node_modules/virtual-bash/dist/commands/${family === "aliases" ? "grep-aliases" : "column"}/index.js`];
  const surface = configuration.declaration.surfaces[family];
  return [...(surface.root ? ["virtual-bash"] : []), ...(surface.subpath ? [surface.subpath] : [])];
}
