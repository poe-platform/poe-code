import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { searchCommands } from "../../../src/commands/search/index.js";
import { makeFileSystem } from "./helpers.js";

const files = {
  "src/first.ts": "export function first() {}\n// TODO: validate\n",
  "src/space name.ts": "// TODO: stream\nexport const next = 1;\n",
  "src/ignored.ts": "// TODO: hidden by ignore\n", "src/.ignore": "ignored.ts\n",
  "src/readme.md": "Documentation\n", "build/cached.ts": "TODO: generated\n", ".ignore": "build/\n",
};

test("agent finds TODO locations and derives sorted source file list", async () => {
  const fs = await makeFileSystem({ args: [], files });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(searchCommands());
  const result = await shell.exec("rg -n -g '*.ts' TODO src | cut -d: -f1 | sort -u | tee changed");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "src/first.ts\nsrc/ignored.ts\nsrc/space name.ts\n");
  assert.equal(Buffer.from(await fs.readFile("/work/changed")).toString(), result.stdout);
});

test("NUL file lists feed xargs without splitting spaces", async () => {
  const fs = await makeFileSystem({ args: [], files });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(searchCommands());
  const result = await shell.exec("rg -l0 TODO src | xargs -0 cat | rg -n TODO");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "2:// TODO: validate\n3:// TODO: stream\n");
});

test("file inventory and missing matches drive shell conditions", async () => {
  const fs = await makeFileSystem({ args: [], files });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(searchCommands());
  const result = await shell.exec("rg --files -g '*.ts' | sort; rg -q FIXME src || printf 'clean\\n'");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "src/first.ts\nsrc/ignored.ts\nsrc/space name.ts\nclean\n");
});

test("negative globs preserve repository ignore rules in file inventory pipelines", async () => {
  const fs = await makeFileSystem({ args: [], files });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(searchCommands());
  const result = await shell.exec("rg --files -g '!*.md' | sort");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "src/first.ts\nsrc/space name.ts\n");
});
