import type { Files } from "./helpers.js";

export function replacement(oldPath: string, newPath = oldPath, before = "old", after = "new") {
  return `--- ${oldPath}\n+++ ${newPath}\n@@ -1 +1 @@\n-${before}\n+${after}\n`;
}

export interface EditFlow {
  readonly name: string;
  readonly files: Files;
  readonly input: string;
  readonly args: readonly string[];
  readonly expected: Files;
  readonly oracle: "git" | "patch";
}

export const mailPatch = "From 0123456789012345678901234567890123456789 Mon Sep 17 00:00:00 2001\n"
  + "From: Example <example@example.invalid>\nDate: Wed, 26 Aug 2026 12:00:00 +0000\n"
  + "Subject: [PATCH] Update target\n\nA small coding-agent edit.\n---\n target | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n\n"
  + "diff --git a/target b/target\nindex 3367afd..3e75765 100644\n"
  + replacement("a/target", "b/target") + "-- \n2.50.1\n";

export const relaxedPatch = "--- target\n+++ target\n@@ -1,3 +1,3 @@\n if (ready) {\n-  old value;\n+    new value;\n }\n";
export const normalPatch = "0a1\n> start\n2c3\n< old\n---\n> new\n4d4\n< remove\n";

export const flows: readonly EditFlow[] = [
  ...[
    ["quoted spaces", "file name.txt", '"a/file name.txt"', '"b/file name.txt"'],
    ["quoted tab escape", "file\tname.txt", '"a/file\\tname.txt"', '"b/file\\tname.txt"'],
    ["quoted UTF-8 octets", "café.txt", '"a/caf\\303\\251.txt"', '"b/caf\\303\\251.txt"'],
  ].map(([name, path, oldPath, newPath]) => ({ name: name!, files: { [path!]: "old\n" },
    input: `diff --git ${oldPath} ${newPath}\n` + replacement(oldPath!, newPath!),
    args: ["-p1"], expected: { [path!]: "new\n" }, oracle: "git" as const })),
  { name: "mail/git preamble and signature", files: { target: "old\n" }, input: mailPatch,
    args: ["-p1"], expected: { target: "new\n" }, oracle: "patch" },
  { name: "sequential same-file sections", files: { target: "old\n" },
    input: replacement("target", "target", "old", "middle") + replacement("target", "target", "middle", "new"),
    args: [], expected: { target: "new\n" }, oracle: "patch" },
  { name: "loose whitespace preserves actual context and literal additions", files: { target: "if\t(ready) {\n\told\tvalue;\n}\n" },
    input: relaxedPatch, args: ["-l"], expected: { target: "if\t(ready) {\n    new value;\n}\n" }, oracle: "patch" },
  { name: "normal patch append change delete", files: { target: "head\nold\ntail\nremove\n" },
    input: normalPatch, args: ["target"], expected: { target: "start\nhead\nnew\ntail\n" }, oracle: "patch" },
];
