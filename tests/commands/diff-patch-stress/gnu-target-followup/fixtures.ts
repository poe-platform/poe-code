import { contextChange, contextHeader, normalChange } from "../parser-regressions/fixtures.js";
import { section } from "../path-regressions/helpers.js";
import { creation, cwd, replacement } from "../safety/helpers.js";
import type { Probe } from "./helpers.js";

export const metadataLines = [
  "rename from target", "rename to sentinel", "copy from target", "copy to sentinel",
  "new file mode 120000", "deleted file mode 120000", "old mode 120000", "new mode 120000",
  "similarity index 100%", "dissimilarity index 100%", "GIT binary patch", "unknown extension metadata",
] as const;
const preamble = "From 0123456789012345678901234567890123456789 Mon Sep 17 00:00:00 2001\n"
  + "From: Path Verifier <verifier@example.invalid>\nSubject: [PATCH] quoted filename\n\n"
  + "Change one literal path.\n---\n file | 2 +-\n\n";
export const metadataProbes: Probe[] = metadataLines.map(metadata => ({
  id: `metadata between-sections: ${metadata}`, args: ["-p1"],
  input: preamble + section("a/first") + `${metadata}\n` + section("a/target"),
  files: { [`${cwd}/first`]: "old\n", [`${cwd}/target`]: "old\n", [`${cwd}/sentinel`]: "untouched\n", [`${cwd}/dir/target`]: "old\n", [`${cwd}/�`]: "old\n", "/target": "outside target\n", "/sandbox/sentinel": "outside sentinel\n" },
}));
export const missingParentProbes: Probe[] = [[], ["-p0"]].map(args => ({
  id: `missing parent ${args.length ? "explicit -p0" : "default strip"}`, args,
  input: replacement("first") + creation("missing/child"),
  files: { [`${cwd}/first`]: "old\n", [`${cwd}/target`]: "old\n", [`${cwd}/dir/target`]: "old\n", [`${cwd}/patch`]: replacement(), [`${cwd}/blocker`]: "old\n" },
}));
export const overlapProbes: Probe[] = [
  { id: "normal-overlapping-old-hunks", input: normalChange + normalChange },
  { id: "context-overlapping-hunks", input: contextChange + contextChange.slice(contextHeader.length) },
].map(fixture => ({ ...fixture, args: ["--batch", "--forward", "--fuzz=0", "--no-backup-if-mismatch", "--reject-file=reject", "--", "target"],
  files: { [`${cwd}/target`]: "old\nkeep\nend\n", [`${cwd}/other`]: "old\n" },
}));
export const probes = [...metadataProbes, ...missingParentProbes, ...overlapProbes];
export const overlapDefaultProbes: Probe[] = overlapProbes.map(probe => ({
  ...probe, id: `default-${probe.id}`, args: ["--batch", "--fuzz=0", "--no-backup-if-mismatch", "--reject-file=reject", "--", "target"],
}));
