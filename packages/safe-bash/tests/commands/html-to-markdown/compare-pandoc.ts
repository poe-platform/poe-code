import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convert } from "./helpers.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = "2272feb92f8c0f151385f59f79eee004c50d14b8";
const native = "/opt/homebrew/bin/pandoc", nativeHash = "61574e53a089110eae07817b91510ff150e826807ac020aa744e0ade23025e0d";
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
assert.equal(hash(readFileSync(native)), nativeHash);
const output = realpathSync(mkdtempSync(join(tmpdir(), "html-markdown-pandoc-evidence-")));
const inputs: Record<string, string> = {};
for (const name of readdirSync(join(repository, "src/commands/html-to-markdown"))) {
  const path = "src/commands/html-to-markdown/" + name;
  const bytes = readFileSync(join(repository, path));
  assert.deepEqual(bytes, execFileSync("git", ["--no-replace-objects", "show", `${source}:${path}`], { cwd: repository }));
  inputs[path] = hash(bytes);
}
const cases: readonly [string, string][] = [
  ["heading-paragraph", "<h1>Release</h1><p>ready</p>"],
  ["emphasis", "<p>Use <strong>bold</strong> and <em>italics</em>.</p>"],
  ["safe-link", '<p><a href="https://example.test/doc">docs</a></p>'],
  ["image", '<p><img src="/logo.png" alt="logo"></p>'],
  ["unordered-list", "<ul><li>one</li><li>two</li></ul>"],
  ["ordered-list", '<ol start="3"><li>one</li><li>two</li></ol>'],
  ["blockquote", "<blockquote><p>one</p><p>two</p></blockquote>"],
  ["inline-code", "<p><code>a ` b</code></p>"],
  ["pre", '<pre><code class="language-js">a\n```\nb</code></pre>'],
  ["entities", "<p>&lt;x&gt; &amp; &copy; &#x1f600;</p>"],
  ["unicode", "<p>中文 café 😀</p>"],
  ["table", "<table><tr><th>A</th><th>B</th></tr><tr><td>x</td><td>y</td></tr></table>"],
  ["raw-drop", "a<script>alert(1)</script><style>x{}</style><!-- comment -->b"],
  ["malformed", "<p>before <b unfinished"],
  ["unknown-entity", "<p>&madeup;</p>"],
  ["textarea", "<textarea><b>literal</b> &amp;</textarea>"],
];
const rows: object[] = [];
let exact = 0, different = 0, errors = 0;
const args = ["--sandbox", "--from=html", "--to=commonmark-raw_html", "--wrap=none"];
for (const [name, html] of cases) {
  const actual = await convert(html);
  const reference = spawnSync(native, args, { input: html, encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
  const same = actual.exitCode === reference.status && actual.stdout === reference.stdout && actual.stderr === reference.stderr;
  if (reference.error || reference.status !== 0 || actual.exitCode !== 0) errors++;
  else if (same) exact++; else different++;
  rows.push({ name, html, ours: { status: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, reference: { status: reference.status, stdout: reference.stdout, stderr: reference.stderr, error: reference.error?.message }, exact: same });
}
for (const [path, expected] of Object.entries(inputs)) assert.equal(hash(readFileSync(join(repository, path))), expected, path);
const report = { source, sourceInputs: inputs, native: { path: native, sha256: nativeHash, version: execFileSync(native, ["--version"]).toString(), args }, profile: "Comparative conversion reference only, not identical CLI/output or HTML5 equivalence; differences are retained, not auto-classified product defects", total: cases.length, exact, different, errors, rows };
writeFileSync(join(output, "REPORT.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output, total: cases.length, exact, different, errors }));
