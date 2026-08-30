export interface Fixture {
  readonly name: string;
  readonly policy?: true;
  readonly args?: readonly string[];
  readonly input?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly symlinks?: Readonly<Record<string, string>>;
  readonly hardlinks?: Readonly<Record<string, string>>;
  readonly nativeStatus?: number;
  readonly hostOnly?: true;
}

export const replacement = (oldName = "target", newName = oldName): string => `--- ${oldName}\n+++ ${newName}\n@@ -1 +1 @@\n-old\n+new\n`;
export const mismatch = replacement().replace("-old\n", "-absent\n");

export const fixtures: readonly Fixture[] = [
  { name: "exact-control" },
  { name: "explicit-absolute-vfs-target", args: ["{root}/work/target"] },
  { name: "explicit-absolute-ignores-header-symlink", args: ["{root}/work/target"], input: replacement("unused"), symlinks: { unused: "target" } },
  ...["orig", "rej"].flatMap(suffix => [
    { name: `exact-unused-${suffix}-symlink`, symlinks: { [`target.${suffix}`]: "../sentinel" } },
    { name: `exact-unused-${suffix}-dangling-symlink`, symlinks: { [`target.${suffix}`]: "missing" } },
    { name: `exact-unused-${suffix}-hardlink`, hardlinks: { [`target.${suffix}`]: "spare" } },
    { name: `dry-run-unused-${suffix}-symlink`, args: ["--dry-run"], symlinks: { [`target.${suffix}`]: "../sentinel" } },
    { name: `dry-run-mismatch-unused-${suffix}-symlink`, args: ["--dry-run"], input: mismatch, symlinks: { [`target.${suffix}`]: "../sentinel" }, nativeStatus: 1 },
  ]),
  { name: "exact-unused-reject-alias-target", args: ["-r", "target"] },
  { name: "dry-run-unused-reject-alias-target", args: ["--dry-run", "-r", "target"] },
  { name: "exact-unused-reject-alias-backup", args: ["-r", "target.orig"] },
  { name: "exact-unused-reject-alias-input", args: ["-i", "input.patch", "-r", "input.patch"], files: { "input.patch": replacement() } },
  { name: "exact-unused-default-reject-is-input", args: ["-i", "target.rej"], files: { "target.rej": replacement() } },
  { name: "exact-unused-default-backup-is-input", args: ["-i", "target.orig"], files: { "target.orig": replacement() } },
  { name: "exact-unused-reject-alias-other-target", input: replacement() + replacement("target.rej"), files: { "target.rej": "old\n" } },
  { name: "exact-unused-backup-alias-other-target", input: replacement() + replacement("target.orig"), files: { "target.orig": "old\n" } },
  { name: "selected-short-name-unused-header-symlink", input: replacement("target", "unused-long-name"), symlinks: { "unused-long-name": "spare" } },
  { name: "selected-short-name-unused-header-hardlink", input: replacement("target", "unused-long-name"), hardlinks: { "unused-long-name": "spare" } },
  { name: "selected-short-name-unused-candidate-reject-symlink", input: replacement("target", "unused-long-name"), files: { "unused-long-name": "old\n" }, symlinks: { "unused-long-name.rej": "../sentinel" } },
  { name: "default-strip-unused-raw-prefix-symlink", input: replacement("prefix/target"), symlinks: { prefix: "directory" }, files: { "directory/target": "old\n" } },
  { name: "strip-one-unused-raw-prefix-symlink", args: ["-p1"], input: replacement("prefix/target"), symlinks: { prefix: "directory" }, files: { "directory/target": "old\n" } },
  { name: "default-strip-basename", input: replacement("directory/target"), files: { "directory/target": "old\n" } },
  { name: "strip-zero-keeps-directory", args: ["-p0"], input: replacement("directory/target"), files: { "directory/target": "old\n" } },
  { name: "strip-one-basename", args: ["-p1"], input: replacement("directory/target"), files: { "directory/target": "old\n" } },
  { name: "index-unused-symlink-unified", input: `Index: unused\n=====\n${replacement()}`, symlinks: { unused: "spare" } },
  { name: "index-unused-shorter-name-unified", input: `Index: x\n=====\n${replacement()}`, files: { x: "old\n" } },
  { name: "index-normal-default-strip", input: "Index: directory/target\n=====\n1c1\n< old\n---\n> new\n", files: { "directory/target": "old\n" } },
  { name: "index-normal-strip-zero", args: ["-p0"], input: "Index: directory/target\n=====\n1c1\n< old\n---\n> new\n", files: { "directory/target": "old\n" } },
  { name: "actual-mismatch-control", input: mismatch, nativeStatus: 1 },
  { name: "actual-backup-symlink", policy: true, input: mismatch, symlinks: { "target.orig": "../sentinel" } },
  { name: "actual-reject-symlink", policy: true, input: mismatch, symlinks: { "target.rej": "../sentinel" } },
  { name: "actual-backup-hardlink", policy: true, input: mismatch, hardlinks: { "target.orig": "spare" } },
  { name: "actual-reject-hardlink", policy: true, input: mismatch, hardlinks: { "target.rej": "spare" } },
  { name: "actual-reject-alias-target", policy: true, input: mismatch, args: ["-r", "target"] },
  { name: "actual-reject-alias-input", policy: true, input: mismatch, args: ["-i", "input.patch", "-r", "input.patch"], files: { "input.patch": mismatch } },
  { name: "actual-reject-traversal", policy: true, input: mismatch, args: ["-r", "../sentinel"] },
  { name: "actual-reject-symlink-parent", policy: true, input: mismatch, args: ["-r", "alias/rejected"], symlinks: { alias: "directory" }, files: { "directory/keep": "keep\n" } },
  { name: "selected-target-symlink", policy: true, args: ["alias"], symlinks: { alias: "target" } },
  { name: "selected-target-symlink-parent", policy: true, args: ["alias/target"], symlinks: { alias: "directory" }, files: { "directory/target": "old\n" } },
  { name: "selected-target-hardlink", policy: true, hardlinks: { alias: "target" } },
  { name: "input-symlink", policy: true, args: ["-i", "alias"], files: { "input.patch": replacement() }, symlinks: { alias: "input.patch" } },
  { name: "auto-absolute-header", policy: true, input: replacement("{root}/work/target") },
  { name: "auto-traversal-header", policy: true, input: replacement("../outside") },
  { name: "unused-auto-traversal-header", policy: true, input: replacement("target", "../outside") },
  { name: "explicit-target-no-host-fallback", policy: true, hostOnly: true, args: ["{root}/work/target"] },
];
