import type { Rule, Violation } from "../model.js";

const id = "release-workflow-maps-to-package";

/**
 * Every release workflow must publish an existing, non-private (or pypi)
 * package — so there is no drift between the workflows and the packages.
 */
export const releaseWorkflowMapsToPackage: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];
    for (const wf of model.releaseWorkflows) {
      for (const dir of wf.targetDirs) {
        const pkg = model.byDir.get(dir);
        if (pkg && (pkg.ecosystem === "pypi" || !pkg.private)) continue;
        violations.push({
          rule: id,
          package: pkg ? pkg.name : dir,
          severity: "error",
          via: wf.file,
          detail: { workflow: wf.file, targetDir: dir, resolved: pkg ? pkg.name : null },
          message: pkg
            ? `release workflow ${wf.file} targets private npm package ${pkg.name}`
            : `release workflow ${wf.file} targets ${dir}, which is not a workspace package`,
          fix: pkg
            ? `Remove "private" from ${pkg.name}, or delete ${wf.file}.`
            : `Point ${wf.file} at an existing package directory, or delete the workflow.`
        });
      }
    }
    return violations;
  }
};
