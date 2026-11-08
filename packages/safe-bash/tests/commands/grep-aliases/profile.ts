import type { NativeCase } from "./native-cases.js";

export function productProfile(fixture: NativeCase) {
  if (fixture.id === "egrep-unsupported-G" || fixture.id === "fgrep-unsupported-G") return {
    qualification: "Grep now supports -G; GNU grep 3.12 setmatcher rejects its combination with the alias's explicit E/F matcher. Preserve the original unsupported-option and BSD captures as historical profiles.",
    product: { code: 2, stdout: "", stderr: `${fixture.alias}: conflicting matchers specified\n` },
  };
  if (fixture.id === "egrep-quiet-before-missing" || fixture.id === "fgrep-quiet-before-missing") return {
    qualification: "Captured BSD emits a later missing-file diagnostic even after -q matches; bounded grep stops before that operand. Original failing capture is retained in first-native.tap.",
    product: { code: 0, stdout: "", stderr: "" },
  };
  return { qualification: fixture.qualification, product: fixture.product };
}
