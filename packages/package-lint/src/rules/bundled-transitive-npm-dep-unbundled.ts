import { allPackages, dependencyEdges, isPublishedNpm, type Rule, type Violation } from "../model.js";

const id = "bundled-transitive-npm-dep-unbundled";

/**
 * When a published package bundles a workspace package, `npm pack` embeds
 * that workspace package's real, unsanitized `package.json` in the tarball.
 * Any external (non-workspace) runtime dependency it declares survives in
 * that nested manifest unless the consumer bundles it too — declaring it in
 * the consumer's own "dependencies" is not enough, since npm's resolver can
 * dedupe the nested requirement to an incompatible sibling version in a
 * mixed workspace (poe-platform/poe-code#512).
 */
export const bundledTransitiveNpmDepUnbundled: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];

    for (const consumer of allPackages(model)) {
      if (!isPublishedNpm(consumer) || consumer.bundledDependencies.length === 0) continue;
      const consumerBundled = new Set(consumer.bundledDependencies);
      const visited = new Set<string>();
      const pending = consumer.bundledDependencies.filter((name) => model.byName.has(name));
      const missing = new Map<string, Set<string>>();

      while (pending.length > 0) {
        const name = pending.shift()!;
        if (visited.has(name)) continue;
        visited.add(name);
        const dep = model.byName.get(name);
        if (!dep) continue;

        for (const edge of dependencyEdges(dep)) {
          if (edge.field === "peerDependencies") continue;
          if (model.byName.has(edge.name)) {
            pending.push(edge.name);
            continue;
          }
          if (consumerBundled.has(edge.name)) continue;
          const requiredBy = missing.get(edge.name) ?? new Set<string>();
          requiredBy.add(dep.name);
          missing.set(edge.name, requiredBy);
        }
      }

      if (missing.size === 0) continue;
      const names = [...missing.keys()].sort();
      violations.push({
        rule: id,
        package: consumer.name,
        severity: "error",
        via: "bundledDependencies",
        detail: {
          missing: names.map((dependency) => ({
            dependency,
            requiredBy: [...(missing.get(dependency) ?? [])].sort()
          }))
        },
        message: `${consumer.name} bundles workspace packages that require ${names.join(", ")}, which ${consumer.name} does not bundle itself`,
        fix: `Add ${names.join(", ")} to "bundledDependencies" (and the prepack/postpack dependency list) so npm never has to resolve them against the rest of the workspace.`
      });
    }

    return violations;
  }
};
