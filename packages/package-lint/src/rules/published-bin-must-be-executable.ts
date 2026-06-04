import { isGenuinelyPublished, type Rule, type Violation } from "../model.js";

const id = "published-bin-must-be-executable";

/**
 * `tsc` emits bin files with mode 0644, so a package that builds its bin with
 * the compiler ships a binary that loses its executable bit and fails with
 * "Permission denied". The fix is the shared `set-bin-executable` step, and it
 * must run in `prepack`: that is the only lifecycle hook guaranteed to run
 * after `prepublishOnly` (which may re-run `tsc` and strip the bit) and right
 * before the tarball is created. This rule holds every genuinely-published npm
 * package that declares a `bin` to that wiring.
 */
export const publishedBinMustBeExecutable: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];

    for (const pkg of model.packages) {
      if (!isGenuinelyPublished(model, pkg)) continue;
      const bins = Object.values(pkg.bin);
      if (bins.length === 0) continue;
      if ((pkg.scripts.prepack ?? "").includes("set-bin-executable")) continue;

      violations.push({
        rule: id,
        package: pkg.name,
        severity: "error",
        detail: { bins },
        message: `published bin is not made executable; its prepack must restore the executable bit or it ships with mode 0644`,
        fix: `Add "node ../../scripts/set-bin-executable.mjs" to ${pkg.name}'s prepack script.`
      });
    }
    return violations;
  }
};
