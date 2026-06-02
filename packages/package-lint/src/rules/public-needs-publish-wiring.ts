import { isPublishedNpm, releaseTargetDirs, type Rule, type Violation } from "../model.js";

const id = "public-needs-publish-wiring";

/**
 * Hygiene: a public (`private !== true`) npm package that no release workflow
 * publishes, or that lacks a `repository.directory`, has no publish path — it
 * claims to be publishable but cannot be published as-is. This is a warning;
 * whether a published package actually *needs* it on npm is decided from real
 * imports by `imported-workspace-dep-unresolvable`, not from declarations.
 */
export const publicNeedsPublishWiring: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];
    const released = releaseTargetDirs(model);

    for (const pkg of model.packages) {
      if (!isPublishedNpm(pkg)) continue;
      const missing: string[] = [];
      if (!released.has(pkg.dir)) missing.push("release-workflow");
      if (pkg.repositoryDirectory === undefined) missing.push("repository.directory");
      if (missing.length === 0) continue;

      violations.push({
        rule: id,
        package: pkg.name,
        severity: "warning",
        detail: { missing },
        message: `public package has no publish path (${missing.join(", ")}); it cannot be published as-is`,
        fix: `Add ${missing.join(" and ")} to publish ${pkg.name}, or set "private": true if it is only vendored into other packages.`
      });
    }
    return violations;
  }
};
