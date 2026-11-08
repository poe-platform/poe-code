import { isPublishedNpm, type Rule, type Violation } from "../model.js";

const id = "lockstep-release-group-valid";

export const lockstepReleaseGroupValid: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];
    for (const workflow of model.releaseWorkflows) {
      for (const group of workflow.lockstepGroups) {
        if (!group.valid || group.dirs.length < 2) {
          violations.push({
            rule: id,
            package: workflow.file,
            severity: "error",
            via: workflow.file,
            detail: { workflow: workflow.file, dirs: group.dirs },
            message: `lockstep release group in ${workflow.file} must declare a version and at least two package directories`,
            fix: `Pass a version and a JSON array with at least two package directories to prepare-lockstep-release in ${workflow.file}.`
          });
          continue;
        }

        const seen = new Set<string>();
        for (const dir of group.dirs) {
          if (seen.has(dir)) {
            violations.push({
              rule: id,
              package: workflow.file,
              severity: "error",
              via: workflow.file,
              detail: { workflow: workflow.file, targetDir: dir, problem: "duplicate" },
              message: `lockstep release group in ${workflow.file} declares ${dir} more than once`,
              fix: `Remove the duplicate ${dir} entry from prepare-lockstep-release in ${workflow.file}.`
            });
            continue;
          }
          seen.add(dir);

          const pkg = model.byDir.get(dir);
          if (!pkg) {
            violations.push({
              rule: id,
              package: dir,
              severity: "error",
              via: workflow.file,
              detail: { workflow: workflow.file, targetDir: dir, problem: "missing" },
              message: `lockstep release group in ${workflow.file} targets ${dir}, which is not a workspace package`,
              fix: `Point prepare-lockstep-release at an existing public package directory.`
            });
            continue;
          }
          if (!isPublishedNpm(pkg)) {
            violations.push({
              rule: id,
              package: pkg.name,
              severity: "error",
              via: workflow.file,
              detail: { workflow: workflow.file, targetDir: dir, problem: "not-public-npm" },
              message: `lockstep release group in ${workflow.file} targets non-public npm package ${pkg.name}`,
              fix: `Remove ${dir} from the group or make ${pkg.name} a public npm package.`
            });
            continue;
          }
          if (!group.publishedDirs.includes(dir)) {
            violations.push({
              rule: id,
              package: pkg.name,
              severity: "error",
              via: workflow.file,
              detail: {
                workflow: workflow.file,
                targetDir: dir,
                problem: "not-published-after-prepare"
              },
              message: `lockstep release group in ${workflow.file} does not publish ${pkg.name} after preparing it`,
              fix: `Publish ${dir} after the prepare-lockstep-release step in ${workflow.file}.`
            });
          }
        }
      }
    }
    return violations;
  }
};
