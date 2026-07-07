import {
  dependencyEdges,
  isPublishedNpm,
  releaseTargetDirs,
  type Rule,
  type Violation
} from "../model.js";

const id = "imported-workspace-dep-unresolvable";

/**
 * Import-driven vendoring check: for each genuinely-published package, every
 * workspace package its shipped source actually imports (by bare name, at
 * runtime — type-only and test imports excluded) must be vendored into its
 * tarball (`bundledDependencies`), compiled into its entrypoint, or itself
 * reach npm AND be declared in the importer's dependencies. A published-but-
 * undeclared import is a phantom dependency that resolves only through
 * hoisting luck and breaks the moment the tree layout changes.
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
      const declared = new Set(dependencyEdges(pkg).map((edge) => edge.name));
      const unresolvable = new Map<string, Set<string>>();

      for (const ref of model.sourceImports.get(pkg.dir) ?? []) {
        if (ref.isTest || ref.typeOnly || ref.kind !== "bare" || !ref.packageName) continue;
        const dep = model.byName.get(ref.packageName);
        if (!dep || dep.name === pkg.name) continue; // only workspace deps, not self
        if (bundled.has(dep.name)) continue; // vendored into the tarball
        if (inlined.has(dep.name)) continue; // compiled into the published entrypoint
        // dep itself reaches npm — but only helps when the importer declares it
        if (isPublishedNpm(dep) && released.has(dep.dir) && declared.has(dep.name)) continue;
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
        message: `${pkg.name} imports workspace packages that are neither bundled nor declared published dependencies: ${deps.join(", ")}`,
        fix: `Vendor them via bundledDependencies, or declare them in dependencies (publishing alone leaves a phantom import): ${deps.join(", ")}.`
      });
    }
    return violations;
  }
};
