import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const baseline = "e9843e601859282de25fa40742529c6be6668bf3";
export const moduleCommit = "9ae34a06662db27897043d77d6145700c109b22c";
export const rendererHash = "a624213e0289a441f1cacbf128dbac0861d23aee0ca3d7a2ad2f98a1d5da6378";
export const subpath = "virtual-bash/commands/html-to-markdown";
export const functions = ["createHtmlToMarkdownCommand", "createHtmlToMarkdownCommands", "htmlToMarkdownCommands"];
export const limitNames = ["maxInputBytes", "maxOutputBytes", "maxTokenBytes", "maxTokens", "maxNodes", "maxDepth", "maxAttributes", "maxTableCells", "maxTableCellBytes", "maxFiles", "maxArgumentBytes", "maxDiagnosticBytes", "maxWorkUnits"];
export const baselineNames = [
  "true", "false", "echo", "pwd", "basename", "dirname", "printf", "mkdir", "touch",
  "cp", "mv", "rm", "rmdir", "ln", "readlink", "realpath", "ls", "cat", "head", "tail",
  "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find",
  "sed", "awk", "jq", "rg", "base64", "base32", "xxd", "od", "sha256sum", "sha1sum",
  "md5sum", "cksum", "gzip", "gunzip", "zcat", "diff", "patch", "chmod", "stat", "mktemp", "tar",
  "paste", "comm", "join", "tac", "expand", "fold", "strings", "seq", "nl", "rev", "unexpand", "split",
  "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column",
];
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function inventory(directory, prefix = "", omittedRootNames = []) {
  const result = {};
  for (const name of readdirSync(directory).sort()) {
    if (!prefix && omittedRootNames.includes(name)) continue;
    const absolute = join(directory, name), relative = prefix + name;
    const stat = lstatSync(absolute);
    assert.ok(!stat.isSymbolicLink(), `symlink forbidden in authenticated tree: ${relative}`);
    if (stat.isDirectory()) Object.assign(result, inventory(absolute, `${relative}/`));
    else {
      assert.ok(stat.isFile(), `non-file: ${relative}`);
      result[relative] = sha256(readFileSync(absolute));
    }
  }
  return result;
}

export function validateDeclaration(value) {
  for (const name of ["candidateCommit", "fixtureCommit"]) assert.match(value[name], /^[a-f0-9]{40}$/);
  for (const name of ["archiveSha256", "packSha256"]) assert.match(value[name], /^[a-f0-9]{64}$/);
  assert.equal(value.baselineCommit, baseline);
  assert.equal(value.rendererSha256, rendererHash);
  assert.equal(value.subpath, subpath);
  assert.ok(typeof value.declaredBy === "string" && value.declaredBy.trim());
  assert.match(value.agentOption, /^[a-zA-Z][a-zA-Z0-9]*$/);
  assert.ok(!["__proto__", "constructor", "prototype", "replace", "regex"].includes(value.agentOption));
  assert.ok(Array.isArray(value.changedProductPaths));
  assert.deepEqual([...new Set(value.changedProductPaths)].sort(), value.changedProductPaths);
  for (const name of value.changedProductPaths) assert.ok(name === "package.json" || /^src\/[a-zA-Z0-9_./-]+$/.test(name));
  assert.ok(value.sourceScopeApproval && typeof value.sourceScopeApproval === "string");
  assert.ok(Array.isArray(value.htmlIoPaths));
  assert.deepEqual([...new Set(value.htmlIoPaths)].sort(), value.htmlIoPaths);
  for (const name of value.htmlIoPaths) assert.ok(["src/commands/html-to-markdown/index.ts", "src/commands/html-to-markdown/input.ts", "src/commands/html-to-markdown/budget.ts"].includes(name), "HTML source adoption is index/I/O routing only");
  for (const name of ["node", "npm", "tsc", "typescript", "nodeTypes", "undiciTypes", "npmRoot"]) assert.ok(typeof value.toolPaths?.[name] === "string" && value.toolPaths[name].startsWith("/"), `absolute read-only tool path: ${name}`);
  for (const name of ["packageFiles", "packFiles", "workerFiles", "toolTrees", "toolExecutables"]) {
    assert.ok(value[name] && typeof value[name] === "object" && Object.keys(value[name]).length > 0, name);
    for (const digest of Object.values(value[name])) assert.match(digest, /^[a-f0-9]{64}$/);
  }
  assert.ok(value.packageFiles["package.json"] && value.packageFiles["README.md"], "full package README admission required");
  assert.ok(value.packFiles["package.json"] && value.packFiles["README.md"], "npm automatic package/README admission required");
  assert.ok(value.workerFiles["dist/commands/regex-execution/worker.js"]);
  assert.ok(value.workerFiles["dist/commands/regex-execution/client.js"]);
  assert.ok(value.packageExports["./commands/html-to-markdown"]);
  assert.ok(!Object.keys(value.packageExports).some(name => name.startsWith("./commands/") && name.includes("*")));
  assert.deepEqual(value.packageExports["./commands/html-to-markdown"], {
    types: "./dist/commands/html-to-markdown/index.d.ts", import: "./dist/commands/html-to-markdown/index.js",
  });
  assert.equal(value.clarifications, "Read README pending boundaries; no exit-status or opaque-preemption expansion");
  return value;
}

export function assertBinding(actual, expected, boundary) {
  assert.deepEqual(actual, expected, `BOUNDARY:${boundary}`);
}

export const semantics = [
  { id: "S01", input: "", output: "" },
  { id: "S02", input: "<h2>Heading</h2><p>Hello <strong>world</strong></p>", output: "## Heading\n\nHello **world**\n" },
  { id: "S03", input: "<p>one <em>two</em> three</p>", output: "one *two* three\n" },
  { id: "S04", input: "<p>before</p><!--gone--><script>alert(1)</script><style>x{}</style><p>after</p>", output: "before\n\nafter\n" },
  { id: "S05", input: "<p>A<em/>B</p>", output: "AB\n" },
  { id: "S06", input: "<a href='javascript:bad'>label</a>", output: "label\n" },
  { id: "S07", input: "<p><em>a</em><a href='https://safe.test/l'>x</a><em>b</em></p>", output: "*a*[x](<https://safe.test/l>)*b*\n" },
  { id: "S08", input: "<p>&#1114112;</p>", output: "", limits: { maxTokenBytes: 8 }, exitCode: 1, stderr: "html-to-markdown: EFBIG: html-to-markdown token bytes limit exceeded\n" },
  { id: "S09", input: "&amp;", output: "", limits: { maxTokenBytes: 4 }, exitCode: 1, stderr: "html-to-markdown: EFBIG: html-to-markdown token bytes limit exceeded\n" },
];

export const publicCases = [
  ["P01", "root/subpath identical functions; explicit export and no HTML wildcard/internal access"],
  ["P02", "74 unique aggregate names; HTML once; curl/safejs/du/expr absent"],
  ["P03", "standalone plugin registers exactly HTML and converts stdin"],
  ["P04", "aggregate collision preflight leaves existing registry unchanged"],
  ["P05", "top replace true overrides nested false and replaces HTML"],
  ["P06", "nested replace true cannot override omitted top replace"],
  ["P07", "aggregate declared module options propagate token refusal"],
  ["P08", "family input budget resets per invocation, not per operand"],
  ["P09", "Shell aggregate output budget remains enforced through owned output"],
  ["P10", "VFS ordered operands and shared stdin; no mutation/fetch"],
  ["P11", "curl remains absent until explicit network plugin; injected transport only"],
  ["P12", "root aggregate regex worker positive, unrelated to HTML ownership"],
  ["P13", "standalone duplicate rejection and explicit replacement"],
  ["P14", "invalid factory limit rejects before acquisition"],
];

export const lifecycleCases = [
  ["L01", "cleanup before acquisition; operation signal; owned output route"],
  ["L02", "preclosed output admits zero VFS reads, never aborts caller"],
  ["L03", "first-read-gated output close drains cooperative iterator before direct settlement"],
  ["L04", "admitted caller abort rejects exact errno-shaped reason after iterator retirement"],
  ["L05", "invalid argv required stderr survives preclosed stdout; zero acquisition"],
  ["L06", "limit refusal required stderr survives stdout closure while stderr write pending"],
  ["L07", "registered cleanup and finally share one iterator retirement"],
  ["L08", "real curl|HTML|head-n0 first-read-gated transport close and dispose drain"],
  ["L09", "real curl|HTML|head-n0 zero-read controlled middleware ordering"],
  ["L10", "real Shell abort and overlapping dispose await registered iterator retirement"],
  ["L11", "unenrolled opaque next receives no invented forced-preemption promise"],
];

export const runtimeCases = [...semantics.map(value => [value.id, "exact bounded conversion bytes/status/stderr"]), ...publicCases, ...lifecycleCases];
export const controlCases = ["C01-missing-export", "C02-wrong-source", "C03-wrong-pack", "C04-missing-dependency", "C05-missing-worker", "C06-poison-sentinel", "C07-source-fallback", "C08-permission-denial", "C09-types-negative", "C10-append-tree"];
