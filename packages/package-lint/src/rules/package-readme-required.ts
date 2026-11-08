import type { Rule, Violation } from "../model.js";

const id = "package-readme-required";

export const packageReadmeRequired: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];

    for (const pkg of model.packages) {
      if (pkg.hasReadme) continue;
      const readmePath = `${pkg.dir}/README.md`;
      violations.push({
        rule: id,
        package: pkg.name,
        severity: "error",
        detail: { path: readmePath },
        message: `workspace package is missing ${readmePath}`,
        fix: `Add ${readmePath} documenting exposed environment variables and config options.`
      });
    }

    return violations;
  }
};
