import {
  isGenuinelyPublished,
  type PackageInfo,
  type Rule,
  type Violation,
  type WorkspaceModel
} from "../model.js";

const id = "no-import-attributes-in-shipped-source";

/**
 * Import attributes (`with { type: "json" }`) are a syntax error before Node
 * 18.20, while the workspace engines floor is `>=18.18` — a dist built from
 * such source crashes at import time on the very Node versions the package
 * claims to support (#517). Applies to every package whose code reaches an npm
 * tarball: genuinely published ones and the private packages they vendor via
 * `bundledDependencies` / inline into their entrypoints.
 */
export const noImportAttributesInShippedSource: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];

    for (const pkg of model.packages) {
      if (!reachesNpm(model, pkg)) continue;
      const files = new Set<string>();

      for (const ref of model.sourceImports.get(pkg.dir) ?? []) {
        if (ref.isTest || !ref.importAttributes) continue;
        files.add(ref.file);
      }

      if (files.size === 0) continue;
      const sorted = [...files].sort();
      violations.push({
        rule: id,
        package: pkg.name,
        severity: "error",
        via: sorted[0]!,
        detail: { files: sorted },
        message: `${pkg.name} ships source with import attributes (\`with { type: ... }\`), a syntax error before Node 18.20 despite the >=18.18 engines floor`,
        fix: `Load the module with createRequire/fs instead of import attributes in: ${sorted.join(", ")}.`
      });
    }

    return violations;
  }
};

function reachesNpm(model: WorkspaceModel, pkg: PackageInfo): boolean {
  if (isGenuinelyPublished(model, pkg)) return true;

  for (const publisher of model.packages) {
    if (!isGenuinelyPublished(model, publisher)) continue;
    if (
      publisher.bundledDependencies.includes(pkg.name) ||
      publisher.inlinedDependencies.includes(pkg.name)
    ) {
      return true;
    }
  }

  return false;
}
