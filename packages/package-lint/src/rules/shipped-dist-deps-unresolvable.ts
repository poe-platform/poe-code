import { isBuiltin } from "node:module";
import type { Rule, Violation, WorkspaceModel } from "../model.js";

const id = "shipped-dist-deps-unresolvable";

function shippedPackageNames(model: WorkspaceModel): Set<string> {
  const names = new Set<string>();
  for (const dir of model.shippedDirs) {
    const pkg = model.byDir.get(dir);
    if (pkg) names.add(pkg.name);
  }
  return names;
}

/**
 * Every runtime dependency of a shipped, tsc-emitted bin entry must resolve
 * from the published `poe-code` tarball: it is in root `dependencies`, a Node
 * builtin, or itself a shipped package. A bare import of a package that is
 * none of these is `ERR_MODULE_NOT_FOUND` when the tarball is installed.
 */
export const shippedDistDepsUnresolvable: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];
    const shipped = shippedPackageNames(model);
    const rootDeps = new Set(Object.keys(model.root.dependencies));
    for (const bin of model.binTargets) {
      const owner = model.byDir.get(bin.dir);
      if (!owner) continue;
      const unresolved = Object.keys(owner.dependencies)
        .filter((dep) => !rootDeps.has(dep) && !isBuiltin(dep) && !shipped.has(dep))
        .sort();
      if (unresolved.length === 0) continue;
      violations.push({
        rule: id,
        package: owner.name,
        severity: "error",
        via: `bin:${bin.bin}`,
        detail: { target: bin.target, unresolved },
        message:
          "shipped bin imports bare names not in root dependencies (ERR_MODULE_NOT_FOUND on install)",
        fix: `Bundle ${bin.bin} so these are inlined, or add each to root "dependencies": ${unresolved.join(", ")}.`
      });
    }
    return violations;
  }
};
