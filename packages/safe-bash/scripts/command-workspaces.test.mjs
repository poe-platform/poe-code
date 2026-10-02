import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
const root = new URL("../../../", import.meta.url);
const names = "bc fd sponge less more xxd od pandoc ssconvert op htmlq csvkit dd shuf yes xmllint apply-patch cmp column csplit du expr factor file getopt hexdump html-to-markdown iconv install pr split timeout tree truncate tsort which xan nl rev tac readlink realpath strings paste join comm expand unexpand date env printenv sleep touch egrep fgrep rg zip base64 md5sum sha1sum sha256sum".split(" ");
const manifest = path => JSON.parse(readFileSync(new URL(path, root), "utf8"));
for (const name of [...names, "docx", "pptx", "pdfunite", "pdfseparate"]) test(name + " has one private portable command owner", () => {
  const packageName = "safe-bash-command-" + name;
  const folder = "packages/" + packageName + "/";
  const pkg = manifest(folder + "package.json");
  assert.equal(pkg.name, packageName);
  assert.equal(pkg.private, true);
  const shell = manifest("packages/safe-bash/package.json");
  assert.equal(shell.devDependencies[packageName], "*");
  assert.equal(shell.poeCode.integration.privateWorkspaces[packageName].portable, true);
  assert.ok(manifest("package.json").workspaces.includes("packages/*"));
  const adapter = name === "xmllint" ? "xml" : name;
  assert.ok(readFileSync(new URL("packages/safe-bash/src/commands/" + adapter + "/index.ts", root), "utf8").includes('export * from "' + packageName + '";'));
});

for (const name of ["more", "xml", "pandoc", "ssconvert", "op", "htmlq", "csvkit", "docx", "pptx", "xan", "pdfunite", "pdfseparate"]) test(name + " core adapter contains only public re-exports", async () => {
  const { default: ts } = await import("typescript");
  const text = readFileSync(new URL("packages/safe-bash/src/commands/" + name + "/index.ts", root), "utf8");
  const source = ts.createSourceFile("xml.ts", text, ts.ScriptTarget.Latest, true);
  assert.ok(source.statements.every(statement => ts.isExportDeclaration(statement)));
});

test("extracted command evaluators stay in their private owners", async () => {
  const { default: ts } = await import("typescript");
  const text = readFileSync(new URL("packages/safe-bash/src/shell/runtime.ts", root), "utf8");
  const source = ts.createSourceFile("runtime.ts", text, ts.ScriptTarget.Latest, true);
  for (const name of ["evalSyncDd", "evalSyncXan"]) {
    assert.ok(!source.statements.some(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name), `${name} must be imported from its command owner`);
  }
});

for (const name of ["dd", "shuf", "yes", "yq", "xml", "csvkit", "pandoc", "ssconvert", "htmlq"]) test(name + " has no leftover implementation modules", () => {
  assert.deepEqual(readdirSync(new URL("packages/safe-bash/src/commands/" + name, root)).filter(file => file.endsWith(".ts")), ["index.ts"]);
});

for (const name of ["csvkit", "pandoc"]) test(name + " is registered for portable integration", () => {
  const packageName = "safe-bash-command-" + name;
  const shell = manifest("packages/safe-bash/package.json");
  assert.equal(shell.devDependencies[packageName], "*");
  assert.equal(shell.poeCode.integration.privateWorkspaces[packageName].portable, true);
});

test("unzip owns argument and overwrite policy while ZIP selection stays shared", () => {
  const source = path => readFileSync(new URL(path, root), "utf8");
  const argumentsSource = source("packages/safe-bash-command-unzip/src/unzip/arguments.ts");
  assert.ok(argumentsSource.includes("export function parseArguments("));
  assert.ok(argumentsSource.includes("export class Answers"));
  const shared = source("packages/safe-bash-zip-engine/src/unzip/arguments.ts");
  assert.ok(shared.includes("export class Selection"));
  assert.ok(!shared.includes("export function parseArguments("));
  assert.ok(!shared.includes("export class Answers"));
  assert.equal(manifest("packages/safe-bash-command-unzip/package.json").private, true);
});

test("curl owns its parser while curl and wget share a lower-level transfer engine", () => {
  const curl = manifest("packages/safe-bash-command-curl/package.json");
  const wget = manifest("packages/safe-bash-command-wget/package.json");
  const engine = manifest("packages/safe-bash-network-engine/package.json");
  assert.equal(wget.devDependencies["safe-bash-command-curl"], undefined);
  assert.equal(engine.devDependencies["safe-bash-command-curl"], undefined);
  assert.ok(curl.exports["./args"]);
  assert.ok(curl.exports["./input"]);
  assert.ok(engine.exports["./transfer"]);
});
