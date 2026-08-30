import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "node_modules/virtual-bash");
const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.equal(metadata.name, "virtual-bash");
assert.deepEqual(metadata.dependencies ?? {}, {});
const records = [];
for (const [subpath, target] of Object.entries(metadata.exports)) {
  const wildcard = subpath.includes("*");
  const names = wildcard ? readdirSync(join(root, dirname(target.import))).filter(name => name.endsWith(".js")).map(name => name.slice(0, -3)).sort() : [null];
  for (const name of names) {
    const specifier = `virtual-bash${subpath === "." ? "" : subpath.slice(1).replace("*", name ?? "")}`;
    const runtimePath = target.import.replace("*", name ?? "");
    const typesPath = target.types.replace("*", name ?? "");
    const files = Object.fromEntries([["runtime", runtimePath], ["types", typesPath]].map(([kind, path]) => {
      const absolute = resolve(root, path);
      assert.equal(realpathSync(absolute), absolute);
      assert.ok(lstatSync(absolute).isFile());
      const bytes = readFileSync(absolute);
      return [kind, { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }];
    }));
    const imported = await import(specifier);
    records.push({ declaredSubpath: subpath, specifier, files, runtimeExports: Object.keys(imported).sort() });
  }
}
const rootModule = await import("virtual-bash");
const contracts = await import("virtual-bash/contracts");
const output = await import("virtual-bash/contracts/output");
assert.equal(rootModule.createOutputOperation, contracts.createOutputOperation);
assert.equal(rootModule.createOutputOperation, output.createOutputOperation);
console.log(JSON.stringify({ qualification: "AUTHOR_RUNTIME_EXPORT_INVENTORY_NOT_ALL_COMMAND_OR_PROVIDER_ACCEPTANCE", declaredExports: metadata.exports, declaredExportKeys: Object.keys(metadata.exports).length, probedSpecifiers: records.length, rootRuntimeExports: Object.keys(rootModule).length, contractsRuntimeExports: Object.keys(contracts).length, outputFactoryIdentity: true, records }, null, 2));
