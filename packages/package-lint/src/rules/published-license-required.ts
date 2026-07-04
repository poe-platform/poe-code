import { isGenuinelyPublished, type Rule, type Violation } from "../model.js";

const id = "published-license-required";
const licenseFileNames = new Set(["license", "licence", "copying"]);

function includesLicenseFile(files: Set<string>): boolean {
  for (const file of files) {
    const fileName = file.split("/").at(-1)?.split(".")[0]?.toLowerCase();
    if (fileName && licenseFileNames.has(fileName)) return true;
  }
  return false;
}

export const publishedLicenseRequired: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];

    for (const pkg of [model.root, ...model.packages]) {
      if (!isGenuinelyPublished(model, pkg)) continue;

      const missing: string[] = [];
      if (!pkg.license) missing.push("license-metadata");
      if (!includesLicenseFile(model.packageFiles.get(pkg.dir)?.files ?? new Set())) {
        missing.push("license-file");
      }
      if (missing.length === 0) continue;

      violations.push({
        rule: id,
        package: pkg.name,
        severity: "error",
        detail: { missing },
        message: `published npm package is missing ${missing.join(" and ")}`,
        fix: `Add an SPDX license field and include LICENSE in ${pkg.dir}/package.json files.`
      });
    }

    return violations;
  }
};
