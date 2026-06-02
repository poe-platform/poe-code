import {
  allPackages,
  dependencyEdges,
  isPublishedNpm,
  type Rule,
  type Violation
} from "../model.js";

const id = "no-published-to-private-dep";

/**
 * No published package may depend (dependencies / peerDependencies /
 * optionalDependencies) on a private workspace package — it is never published,
 * so the consumer ships a dependency that cannot be installed.
 * `optionalDependencies` is the exact same-name collision vector.
 */
export const noPublishedToPrivateDep: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];
    for (const consumer of allPackages(model)) {
      if (!isPublishedNpm(consumer)) continue;
      for (const edge of dependencyEdges(consumer)) {
        const dep = model.byName.get(edge.name);
        if (!dep || !dep.private) continue;
        violations.push({
          rule: id,
          package: consumer.name,
          severity: "error",
          via: edge.field,
          detail: { dependency: dep.name, field: edge.field },
          message: `published package depends on private workspace package ${dep.name} via ${edge.field}`,
          fix: `Drop the ${edge.field} on ${dep.name}, publish ${dep.name}, or vendor it with a pinned range (bundledDependencies) — a private package never reaches npm.`
        });
      }
    }
    return violations;
  }
};
