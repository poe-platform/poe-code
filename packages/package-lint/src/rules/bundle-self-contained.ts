import { findBundleIssues } from "../bundle-policy.js";
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
    for (const issue of findBundleIssues(
      model.root,
      workspace,
      build.metafile,
      model.packageFiles.get(".")?.files ?? new Set()
    )) {
      violations.push({
        rule: id,
        package: workspace.has(issue.external) ? issue.external : model.root.name,
        severity: "error",
        via: "bundle",
        detail: { ...issue },
        message: `bundle import ${issue.external} violates publication policy: ${issue.reason}`,
        fix: "Inline private workspace code or supply the exact declared and packed canonical artifact; declare ordinary runtime dependencies."
      });
    }
    return violations;
  }
};
