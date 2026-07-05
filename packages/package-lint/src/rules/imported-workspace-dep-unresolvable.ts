import { isPublishedNpm, releaseTargetDirs, type Rule, type Violation } from "../model.js";

const id = "imported-workspace-dep-unresolvable";

/**
 * Import-driven vendoring check: for each genuinely-published package, every
 * workspace package its shipped source actually imports (by bare name, at
 * runtime — type-only and test imports excluded) must be vendored into its
 * tarball (`bundledDependencies`) or itself reach npm. Otherwise the published
 * package ships an import that resolves to nothing.
 */
export const importedWorkspaceDepUnresolvable: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];
    const released = releaseTargetDirs(model);

    for (const pkg of model.packages) {
      if (!isPublishedNpm(pkg) || !released.has(pkg.dir)) continue;
      const bundled = new Set(pkg.bundledDependencies);
      const inlined = new Set(pkg.inlinedDependencies);
      const unresolvable = new Map<string, Set<string>>();

      for (const ref of model.sourceImports.get(pkg.dir) ?? []) {
        if (ref.isTest || ref.typeOnly || ref.kind !== "bare" || !ref.packageName) continue;
        const dep = model.byName.get(ref.packageName);
        if (!dep || dep.name === pkg.name) continue; // only workspace deps, not self
        if (bundled.has(dep.name)) continue; // vendored into the tarball
        if (inlined.has(dep.name)) continue; // compiled into the published entrypoint
        if (isPublishedNpm(dep) && released.has(dep.dir)) continue; // dep itself reaches npm
        const files = unresolvable.get(dep.name) ?? new Set<string>();
        files.add(ref.file);
        unresolvable.set(dep.name, files);
      }

      if (unresolvable.size === 0) continue;
      const deps = [...unresolvable.keys()].sort();
      violations.push({
        rule: id,
        package: pkg.name,
        severity: "error",
        via: "imports",
        detail: {
          unresolvable: deps.map((d) => ({
            dependency: d,
            files: [...(unresolvable.get(d) ?? [])].sort()
          }))
        },
        message: `${pkg.name} imports workspace packages that are neither bundled nor published: ${deps.join(", ")}`,
        fix: `Vendor them via bundledDependencies, publish them, or stop importing them: ${deps.join(", ")}.`
      });
    }
    return violations;
  }
};
