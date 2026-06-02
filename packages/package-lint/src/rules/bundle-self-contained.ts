import { isBuiltin } from "node:module";
import type { Rule, Violation, WorkspaceModel } from "../model.js";

const id = "bundle-self-contained";

function workspaceNames(model: WorkspaceModel): Set<string> {
  const names = new Set(model.packages.map((p) => p.name));
  names.add(model.root.name);
  return names;
}

/**
 * Build-aware: the bundled entry must inline every referenced workspace package
 * (they are not on npm) and externalize nothing that is absent from root
 * `dependencies`. Reads the esbuild metafile via {@link import("../model.js").loadBuildView}.
 */
export const bundleSelfContained: Rule = {
  id,
  requiresBuild: true,
  run(model, build) {
    if (!build) return [];
    const violations: Violation[] = [];
    const workspace = workspaceNames(model);
    const rootDeps = new Set(Object.keys(model.root.dependencies));

    for (const external of [...build.externals].sort()) {
      if (workspace.has(external)) {
        violations.push({
          rule: id,
          package: external,
          severity: "error",
          via: "bundle",
          detail: { external, reason: "workspace-not-inlined" },
          message: `workspace package ${external} is externalized by the bundle instead of inlined; it is unpublished and will not resolve at runtime`,
          fix: `Add a source alias for ${external} so the bundle inlines it.`
        });
      } else if (!rootDeps.has(external) && !isBuiltin(external)) {
        violations.push({
          rule: id,
          package: model.root.name,
          severity: "error",
          via: "bundle",
          detail: { external, reason: "undeclared-dependency" },
          message: `bundle externalizes ${external}, which is not declared in root dependencies`,
          fix: `Add ${external} to root "dependencies".`
        });
      }
    }
    return violations;
  }
};
