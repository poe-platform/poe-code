import { textBytes, type BenchmarkCase } from "./model.js";

function fixture(name: string, tags: string[], script: string, stdout: string, initialFiles: Record<string, string> = {}, files = initialFiles, exitCode = 0): BenchmarkCase {
  const encode = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, textBytes(text)]));
  return { name, tier: "plugin-integration", tags, source: "plugin-integration", script, initialFiles: encode(initialFiles), stdin: "", env: {},
    expected: { stdout: textBytes(stdout), stderr: "", exitCode, files: encode(files) } };
}

export function pluginFixtures(): BenchmarkCase[] {
  const emptyInputFiles = { "not-stdin": "match\n" };
  const patch = "--- old\n+++ new\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n";
  return [
    fixture("plugin-jq-map-pipeline", ["jq", "pipelines"], `printf '{"values":[1,2,3]}\\n' | jq -c '.values | map(. * 2)'`, "[2,4,6]\n"),
    fixture("plugin-rg-file-locations", ["rg", "files"], "rg -n --no-heading --sort=path TODO src", "src/a.ts:2:TODO first\nsrc/b.ts:1:TODO second\n", { "src/a.ts": "first\nTODO first\n", "src/b.ts": "TODO second\n" }),
    fixture("plugin-rg-empty-pipe-implicit", ["rg", "stdin", "pipelines"], "printf '' | rg match", "", emptyInputFiles, emptyInputFiles, 1),
    fixture("plugin-rg-empty-pipe-explicit", ["rg", "stdin", "pipelines"], "printf '' | rg match -", "", emptyInputFiles, emptyInputFiles, 1),
    fixture("plugin-bytes-encode-decode-hash", ["bytes", "hash", "pipelines"], "printf hello | base64 | base64 -d | sha256sum", "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824  -\n"),
    fixture("plugin-bytes-compression-roundtrip", ["bytes", "compression", "pipelines"], "printf 'a\\nb\\n' | gzip -c | gunzip -c", "a\nb\n"),
    fixture("plugin-diff-patch-roundtrip", ["diff", "patch", "files"], "diff -u --label old --label new old new > change; patch /fixture/old < change; cat old", "patching file /fixture/old\na\nc\n", { old: "a\nb\n", new: "a\nc\n" }, { old: "a\nc\n", new: "a\nc\n", change: patch }),
  ];
}
