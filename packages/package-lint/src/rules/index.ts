import type { BuildView, LintResult, Rule, Violation, WorkspaceModel } from "../model.js";
import { shippedDistDepsUnresolvable } from "./shipped-dist-deps-unresolvable.js";
import { noPublishedToPrivateDep } from "./no-published-to-private-dep.js";
import { publishedDepNeedsVersionRange } from "./published-dep-needs-version-range.js";
import { publicNeedsPublishWiring } from "./public-needs-publish-wiring.js";
import { releaseWorkflowMapsToPackage } from "./release-workflow-maps-to-package.js";
import { lockstepReleaseGroupValid } from "./lockstep-release-group-valid.js";
import { noCrossPackageRelativeImport } from "./no-cross-package-relative-import.js";
import { importedWorkspaceDepUnresolvable } from "./imported-workspace-dep-unresolvable.js";
import { exportsSubpathResolvable } from "./exports-subpath-resolvable.js";
import { bundleSelfContained } from "./bundle-self-contained.js";
import { bundledTransitiveNpmDepUnbundled } from "./bundled-transitive-npm-dep-unbundled.js";
import { publishedBinMustBeExecutable } from "./published-bin-must-be-executable.js";
import { packageReadmeRequired } from "./package-readme-required.js";
import { runtimeFileAssetsCollocated } from "./runtime-file-assets-collocated.js";
import { runtimeFileAssetsPackaged } from "./runtime-file-assets-packaged.js";
import { publishedLicenseRequired } from "./published-license-required.js";

export const rules: Rule[] = [
  shippedDistDepsUnresolvable,
  noPublishedToPrivateDep,
  publishedDepNeedsVersionRange,
  publicNeedsPublishWiring,
  releaseWorkflowMapsToPackage,
  lockstepReleaseGroupValid,
  noCrossPackageRelativeImport,
  importedWorkspaceDepUnresolvable,
  exportsSubpathResolvable,
  bundleSelfContained,
  bundledTransitiveNpmDepUnbundled,
  publishedBinMustBeExecutable,
  packageReadmeRequired,
  runtimeFileAssetsCollocated,
  runtimeFileAssetsPackaged,
  publishedLicenseRequired
];

export function runRules(model: WorkspaceModel, build?: BuildView, only?: string[]): LintResult {
  if (only && only.length > 0) {
    const known = new Set(rules.map((rule) => rule.id));
    const unknown = only.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown package-lint rule: ${unknown.join(", ")}. Known rules: ${rules
          .map((rule) => rule.id)
          .join(", ")}`
      );
    }
  }
  const selected = only && only.length > 0 ? rules.filter((r) => only.includes(r.id)) : rules;
  const violations: Violation[] = [];
  const skipped: string[] = [];

  for (const rule of selected) {
    if (rule.requiresBuild && !build) {
      skipped.push(rule.id);
      continue;
    }
    violations.push(...rule.run(model, build));
  }

  return {
    summary: {
      packages: model.packages.length,
      rules: selected.length,
      violations: violations.length,
      ok: violations.length === 0
    },
    evaluated: selected.map((r) => r.id),
    violations,
    skipped
  };
}
