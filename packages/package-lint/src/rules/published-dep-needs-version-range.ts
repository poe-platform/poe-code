import semver from "semver";

import {
  allPackages,
  dependencyEdges,
  isPublishedNpm,
  type Rule,
  type Violation
} from "../model.js";

const id = "published-dep-needs-version-range";

/** A `*` / `workspace:*`-style range that does not pin to a bounded set of versions. */
function isLooseRange(spec: string): boolean {
  const s = spec.trim();
  if (s === "" || s === "*" || s === "x" || s === "X" || s === "latest") return true;
  if (s.startsWith("workspace:")) {
    const rest = s.slice("workspace:".length);
    return rest === "" || rest === "*" || rest === "^" || rest === "~";
  }
  return false;
}

function isDeclaredLockstepDependency(
  model: Parameters<Rule["run"]>[0],
  consumerDir: string,
  dependencyDir: string
): boolean {
  return model.releaseWorkflows.some(
    (workflow) =>
      workflow.targetDirs.includes(consumerDir) &&
      workflow.targetDirs.includes(dependencyDir) &&
      workflow.lockstepGroups.some(
        (group) =>
          group.valid &&
          group.dirs.includes(consumerDir) &&
          group.dirs.includes(dependencyDir) &&
          group.publishedDirs.includes(consumerDir) &&
          group.publishedDirs.includes(dependencyDir)
      )
  );
}

/**
 * A published → published workspace dependency must use a concrete range. On
 * npm a `*` range resolves to whatever the registry returns, which is the
 * same-name collision vector.
 */
export const publishedDepNeedsVersionRange: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];
    for (const consumer of allPackages(model)) {
      if (!isPublishedNpm(consumer)) continue;
      for (const edge of dependencyEdges(consumer)) {
        const dep = model.byName.get(edge.name);
        if (!dep || !isPublishedNpm(dep)) continue;
        if (edge.field !== "peerDependencies" && consumer.bundledDependencies.includes(dep.name)) {
          continue;
        }
        if (!isLooseRange(edge.spec) && !semver.satisfies(dep.version, edge.spec)) {
          violations.push({
            rule: id,
            package: consumer.name,
            severity: "error",
            via: edge.field,
            detail: {
              dependency: dep.name,
              field: edge.field,
              range: edge.spec,
              version: dep.version
            },
            message: `published dependency ${dep.name}@${edge.spec} does not include workspace version ${dep.version}`,
            fix: `Replace "${edge.spec}" with a concrete range that includes ${dep.version}, such as "^${dep.version}".`
          });
          continue;
        }
        if (isDeclaredLockstepDependency(model, consumer.dir, dep.dir)) continue;
        if (!isLooseRange(edge.spec)) continue;
        violations.push({
          rule: id,
          package: consumer.name,
          severity: "error",
          via: edge.field,
          detail: { dependency: dep.name, field: edge.field, range: edge.spec },
          message: `published dependency ${dep.name}@${edge.spec} needs a concrete version range`,
          fix: `Replace "${edge.spec}" with a concrete range such as "^${dep.version}". If ${consumer.name} and ${dep.name} are always released together, declare both packages with ./.github/actions/prepare-lockstep-release in their shared release workflow.`
        });
      }
    }
    return violations;
  }
};
