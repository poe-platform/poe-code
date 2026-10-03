import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Integration only: native -U must operate on real files. Unit tests use VFS.
const corpus = JSON.parse(await readFile(new URL("../fixtures/native.json", import.meta.url), "utf8"));
const tools = process.env.AST_GREP_BINARY ? [process.env.AST_GREP_BINARY] : ["ast-grep", "sg"];
const tool = tools.find(command => spawnSync(command, ["--version"], {
  encoding: "utf8", timeout: 2000
}).stdout?.startsWith("ast-grep "));
if (!tool) {
  if (process.env.AST_GREP_BINARY) throw new Error("AST_GREP_BINARY is not an ast-grep executable");
  console.log("SKIP: native ast-grep is not installed");
  process.exit(0);
}
const out = fileURLToPath(new URL("../../../out/", import.meta.url));
await mkdir(out, { recursive: true });
const directory = await mkdtemp(path.join(out, "ast-grep-native-"));
const fields = rows => rows.map(({ file, range, text, replacement, metaVariables }) => ({
  file, range, text, replacement, metaVariables
}));
try {
  for (const fixture of corpus.cases) {
    const file = `input.${fixture.lang}`;
    const target = path.join(directory, file);
    await writeFile(target, fixture.source);
    const args = ["run", "-l", fixture.lang, "-p", fixture.pattern, "-r", fixture.rewrite, file];
    const matches = spawnSync(tool, [...args, "--json=compact"], {
      cwd: directory, encoding: "utf8", timeout: 5000
    });
    assert.ifError(matches.error);
    assert.equal(matches.status, 0, matches.stderr);
    assert.deepEqual(fields(JSON.parse(matches.stdout)), fields(fixture.matches.map(row => ({ ...row, file }))), fixture.name);
    for (const flag of ["-U", "--update-all"]) {
      await writeFile(target, fixture.source);
      const result = spawnSync(tool, [...args, flag], { cwd: directory, encoding: "utf8", timeout: 5000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(target, "utf8"), fixture.updated, `${fixture.name}: ${flag}`);
    }
  }
  console.log(`Verified native JSON and both file update flags for ${corpus.cases.length} fixtures`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
