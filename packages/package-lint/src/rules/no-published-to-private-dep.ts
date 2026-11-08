import {
  allPackages,
  dependencyEdges,
  isPublishedNpm,
  type DependencyEdge,
  type PackageInfo,
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
        if (!dep) continue;
        if (edge.field !== "peerDependencies" && consumer.bundledDependencies.includes(dep.name)) {
          violations.push(
            ...collectBundledPrivateDependencyViolations({
              consumer,
              bundledRoot: dep,
              modelByName: model.byName,
              consumerBundled: new Set(consumer.bundledDependencies),
              via: [dep.name]
            })
          );
          if (dep.private) continue;
        }
        if (!dep.private) {
          continue;
        }
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

function collectBundledPrivateDependencyViolations(options: {
  consumer: PackageInfo;
  bundledRoot: PackageInfo;
  modelByName: ReadonlyMap<string, PackageInfo>;
  consumerBundled: ReadonlySet<string>;
  via: string[];
}): Violation[] {
  const violations: Violation[] = [];
  const visited = new Set<string>();
  const pending: { pkg: PackageInfo; via: string[] }[] = [
    { pkg: options.bundledRoot, via: options.via }
  ];

  while (pending.length > 0) {
    const current = pending.shift()!;
    if (visited.has(current.pkg.name)) {
      continue;
    }
    visited.add(current.pkg.name);

    for (const edge of dependencyEdges(current.pkg)) {
      const dep = options.modelByName.get(edge.name);
      if (!dep) {
        if (
          isProvidedExternalRuntimeEdge(
            options.consumer,
            current.pkg,
            edge,
            options.consumerBundled
          )
        ) {
          continue;
        }
        violations.push({
          rule: id,
          package: options.consumer.name,
          severity: "error",
          via: edge.field,
          detail: {
            dependency: edge.name,
            field: edge.field,
            bundledVia: current.via
          },
          message: `published package bundles ${current.via.join(" -> ")}, whose ${edge.field} requires external package ${edge.name}`,
          fix: `Add ${edge.name} to ${options.consumer.name} "dependencies" or vendor it with bundledDependencies so ${current.pkg.name} can resolve it after install.`
        });
        continue;
      }

      if (dep.private) {
        if (isBundledRuntimeEdge(current.pkg, edge, dep, options.consumerBundled)) {
          pending.push({ pkg: dep, via: [...current.via, dep.name] });
          continue;
        }

        violations.push({
          rule: id,
          package: options.consumer.name,
          severity: "error",
          via: edge.field,
          detail: {
            dependency: dep.name,
            field: edge.field,
            bundledVia: current.via
          },
          message: `published package bundles ${current.via.join(" -> ")}, whose ${edge.field} requires private workspace package ${dep.name}`,
          fix: `Bundle ${dep.name} into ${current.pkg.name}, publish ${dep.name}, or remove the ${edge.field} edge from the bundled package manifest.`
        });
      }
    }
  }

  return violations;
}

function hasOwn(record: Record<string, string>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, name);
}

function isProvidedExternalRuntimeEdge(
  consumer: PackageInfo,
  pkg: PackageInfo,
  edge: DependencyEdge,
  consumerBundled: ReadonlySet<string>
): boolean {
  return (
    edge.field === "peerDependencies" ||
    pkg.bundledDependencies.includes(edge.name) ||
    consumerBundled.has(edge.name) ||
    hasOwn(consumer.dependencies, edge.name) ||
    hasOwn(consumer.optionalDependencies, edge.name)
  );
}

function isBundledRuntimeEdge(
  pkg: PackageInfo,
  edge: DependencyEdge,
  dep: PackageInfo,
  consumerBundled: ReadonlySet<string>
): boolean {
  return (
    edge.field !== "peerDependencies" &&
    (pkg.bundledDependencies.includes(dep.name) || consumerBundled.has(dep.name))
  );
}
