export type Mode = "normal" | "atomic" | "dry-run" | "atomic-dry-run";
export interface Fixture {
  name: string;
  files: Record<string, string>;
  symlinks?: Record<string, string>;
  hardlinks?: Record<string, string>;
  input: string;
  args?: string[];
  shell?: boolean;
  policy?: "selected-loop" | "output-alias" | "backup-alias" | "creation-dry-run";
}

export const replacement = (header = "unused-long-name", old = "old") =>
  `--- a\n+++ ${header}\n@@ -1 +1 @@\n-${old}\n+new\n`;
const creation = "--- /dev/null\n+++ a\n@@ -0,0 +1 @@\n+old\n";
export const sentinel = "untouched\n";

export const creations: Fixture[] = [
  { name: "create-then-select-a-unused-symlink", files: { sentinel }, symlinks: { "work/unused-long-name": "../sentinel" }, input: creation + replacement() },
  { name: "create-then-select-a-unused-hardlink", files: { sentinel }, hardlinks: { "work/unused-long-name": "sentinel" }, input: creation + replacement() },
  { name: "create-then-select-a-unused-symlink-parent", files: { sentinel, "spare/target": "old\n" }, symlinks: { "work/unused-long-name": "../spare" }, input: creation + replacement("unused-long-name/target") },
];
export const loop: Fixture = {
  name: "existing-a-unused-loop", files: { sentinel, "work/a": "old\n" },
  symlinks: { "work/unused-long-name": "unused-long-name" }, input: replacement(),
};
export const cases: { fixture: Fixture; mode: Mode }[] = [
  ...creations.flatMap(fixture => (["normal", "atomic"] as const).map(mode => ({ fixture, mode }))),
  ...(["normal", "atomic", "dry-run", "atomic-dry-run"] as const).map(mode => ({ fixture: loop, mode })),
  { fixture: { ...creations[0]!, policy: "creation-dry-run" }, mode: "dry-run" },
  ...(["normal", "atomic", "dry-run", "atomic-dry-run"] as const).map(mode => ({ fixture: { ...loop, name: "explicit-selected-loop", args: ["unused-long-name"], policy: "selected-loop" as const }, mode })),
  ...(["normal", "atomic"] as const).map(mode => ({ fixture: { ...loop, name: "actual-reject-alias-selected-a", input: replacement("unused-long-name", "missing"), args: ["-r", "a"], policy: "output-alias" as const }, mode })),
  ...(["normal", "atomic"] as const).map(mode => ({ fixture: {
    ...loop, name: "offset-actual-backup-hardlink-to-sentinel", files: { sentinel, "work/a": "padding\nold\n" },
    hardlinks: { "work/a.orig": "sentinel" }, policy: "backup-alias" as const,
  }, mode })),
  ...(["normal", "atomic"] as const).map(mode => ({ fixture: {
    ...loop, name: "shell-explicit-absolute-target-overrides-headers", shell: true,
    files: { sentinel, "work/a": "decoy\n", "authorized/a": "old\n" }, args: ["{root}/authorized/a"],
  }, mode })),
];
