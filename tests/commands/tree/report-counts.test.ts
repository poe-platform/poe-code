import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";

async function fixture() {
  const fs = createMemoryFileSystem();
  for (const directory of ["tree-input", "tree-input/sub", "empty", "files", "hidden", "dirs", "dirs/empty", "links"]) await fs.mkdir(`/${directory}`);
  for (const name of ["tree-input/a.txt", "tree-input/sub/b.txt", "files/one", "hidden/.secret"]) await fs.writeFile(`/${name}`, new Uint8Array());
  await fs.symlink!("../tree-input/sub", "/links/dir");
  await fs.symlink!("absent", "/links/broken");
  return fs;
}

const cases: readonly [string, readonly string[], number, number | undefined][] = [
  ["populated root", ["tree-input"], 2, 2],
  ["empty root", ["empty"], 0, 0],
  ["file-only populated root", ["files"], 1, 1],
  ["empty child directory", ["dirs"], 2, 0],
  ["hidden-only root", ["hidden"], 0, 0],
  ["hidden included", ["-a", "hidden"], 1, 1],
  ["all entries excluded", ["-I", "*", "tree-input"], 0, 0],
  ["all files filtered", ["-P", "none", "files"], 0, 0],
  ["directory-only empty report", ["-d", "files"], 0, undefined],
  ["directory-only populated report", ["-d", "tree-input"], 2, undefined],
  ["depth-one displayed entries", ["-L1", "tree-input"], 2, 1],
  ["repeated roots accumulate", ["tree-input", "tree-input"], 4, 4],
  ["empty, populated and file roots accumulate", ["empty", "tree-input", "files/one"], 2, 3],
  ["directory and broken links", ["links"], 2, 1],
  ["followed directory links", ["-l", "links"], 2, 2],
];

for (const [name, args, directories, files] of cases) test(`tree 2.2.1 count retained: ${name}`, async () => {
  const fs = await fixture();
  for (const charset of ["ASCII", "UTF-8"]) {
    const env = { TREE_CHARSET: charset };
    const text = await run(args, {}, { fs, env });
    const report = `${directories} ${directories === 1 ? "directory" : "directories"}${files === undefined ? "" : `, ${files} ${files === 1 ? "file" : "files"}`}\n`;
    assert.equal(text.exitCode, 0, text.stderr);
    assert.equal(text.stderr, "");
    assert.ok(text.stdout.endsWith(`\n${report}`));
    const json = await run(["-Ji", ...args], {}, { fs, env });
    assert.equal(json.exitCode, 0, json.stderr);
    assert.equal(json.stderr, "");
    assert.deepEqual(JSON.parse(json.stdout).at(-1), { type: "report", directories, ...(files === undefined ? {} : { files }) });
  }
});

test("original strict breadth output remains different; native modern count is preserved", async () => {
  const result = await run(["tree-input"], {}, { fs: await fixture(), env: { LANG: "C", LC_ALL: "C" } });
  assert.equal(result.stdout, "tree-input\n|-- a.txt\n`-- sub\n    `-- b.txt\n\n2 directories, 2 files\n");
  const unicode = await run(["tree-input"], {}, { fs: await fixture(), env: { LC_ALL: "C", TREE_CHARSET: "UTF-8" } });
  assert.equal(unicode.stdout, "tree-input\n├── a.txt\n└── sub\n    └── b.txt\n\n2 directories, 2 files\n");
  assert.notEqual(unicode.stdout, "tree-input\n├── a.txt\n└── sub\n    └── b.txt\n\n1 directory, 2 files\n");
});
