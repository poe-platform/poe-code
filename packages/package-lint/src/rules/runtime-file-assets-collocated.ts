import type { Rule, Violation } from "../model.js";

const id = "runtime-file-assets-collocated";

export const runtimeFileAssetsCollocated: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];
    for (const pkg of model.packages) {
      for (const ref of model.runtimeFileAssets.get(pkg.dir) ?? []) {
        if (ref.isTest || !ref.externalPackageRelPath) continue;
        violations.push({
          rule: id,
          package: pkg.name,
          severity: "error",
          via: `runtime-file:${ref.sourceFile}`,
          detail: {
            sourceFile: ref.sourceFile,
            runtimePath: ref.externalPackageRelPath,
            expression: ref.expression
          },
          message: `${ref.sourceFile} reads a runtime file asset outside ${pkg.name}'s package boundary`,
          fix: "Move the asset under the package that reads it, copy it into dist, and ship it from that package."
        });
      }
    }
    return violations;
  }
};
