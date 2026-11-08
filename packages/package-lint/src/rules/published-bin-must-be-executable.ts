import { isGenuinelyPublished, type Rule, type Violation } from "../model.js";

const id = "published-bin-must-be-executable";

function splitShellLine(line: string): string[] {
  return line
    .trim()
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripQuotes(value: string): string {
  let out = value;
  if (
    ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) &&
    out.length >= 2
  ) {
    out = out.slice(1, -1);
  }
  return out.replaceAll("\\", "/");
}

function prepackRunsSetBinExecutable(prepack: string): boolean {
  for (const line of prepack.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    for (const part of splitShellLine(trimmed)) {
      const token = stripQuotes(part);
      if (
        token === "scripts/set-bin-executable.mjs" ||
        token === "./scripts/set-bin-executable.mjs" ||
        token.endsWith("/scripts/set-bin-executable.mjs")
      ) {
        return true;
      }
    }
  }
  return false;
}

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
      if (prepackRunsSetBinExecutable(pkg.scripts.prepack ?? "")) continue;

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
