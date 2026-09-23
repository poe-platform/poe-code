import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./helpers.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { mikeYqCommands } from "../../../src/commands/yq/mike.js";
import { MockS3Client, S3FileSystem } from "@poe-code/safe-fs";

const inputs = [
  ["csv", "c", "name,count\nChangedOne,7\nChangedTwo,9\n", '[{"name":"ChangedOne","count":7},{"name":"ChangedTwo","count":9}]'],
  ["tsv", "t", "name\tcount\nChangedOne\t7\n", '[{"name":"ChangedOne","count":7}]'],
  ["props", "p", "name = ChangedOne\ncount = 7\n", '{"name":"ChangedOne","count":"7"}'],
  ["xml", "x", "<changed><name>ChangedOne</name><count>7</count></changed>\n", '{"changed":{"name":"ChangedOne","count":"7"}}'],
  ["ini", "i", "[changed]\nname=ChangedOne\ncount=7\n", '{"changed":{"name":"ChangedOne","count":"7"}}'],
  ["toml", "toml", 'name = "ChangedOne"\ncount = 7\n', '{"name":"ChangedOne","count":7}'],
  ["base64", "base64", "Q2hhbmdlZCBPbmU=\n", '"Changed One"'],
  ["uri", "uri", "Changed%20One", '"Changed One"'],
] as const;

for (const [format, alias, input, expected] of inputs) {
  test(`Mike yq decodes ${format} and its alias`, async () => {
    for (const name of new Set([format, alias])) {
      assert.deepEqual(await run([`--input-format=${name}`, "-o=j", "-I=0", "."], input), { status: 0, stdout: expected + "\n", stderr: "" });
    }
  });
}

const mapping = "name: ChangedOne\ncount: 7\n";
for (const [format, input, expected] of [
  ["csv", "- name: ChangedOne\n  count: 7\n- name: ChangedTwo\n  count: 9\n", "name,count\nChangedOne,7\nChangedTwo,9\n"],
  ["tsv", "- name: ChangedOne\n  count: 7\n", "name\tcount\nChangedOne\t7\n"],
  ["props", mapping, "name = ChangedOne\ncount = 7\n"],
  ["xml", mapping, "<name>ChangedOne</name>\n<count>7</count>\n"],
  ["ini", mapping, "name  = ChangedOne\ncount = 7\n"],
  ["toml", mapping, 'name = "ChangedOne"\ncount = 7\n'],
  ["base64", "Changed One\n", "Q2hhbmdlZCBPbmU="],
  ["uri", "Changed One\n", "Changed+One"],
  ["shell", mapping, "name=ChangedOne\ncount=7\n"],
  ["lua", mapping, 'return {\n\t["name"] = "ChangedOne";\n\t["count"] = 7;\n};\n'],
] as const) {
  test(`Mike yq encodes ${format}`, async () => {
    assert.deepEqual(await run([`-o=${format}`, "."], input), { status: 0, stdout: expected, stderr: "" });
  });
}

test("format conversions preserve quotas and reject malformed data", async () => {
  for (const [format, input] of [["csv", 'name\n"unterminated'], ["base64", "%%%"], ["uri", "%ZZ"], ["xml", "<a></b>"]] as const) {
    assert.equal((await run([`-p=${format}`, "."], input)).status, 1);
  }
  for (const limits of [{ maxNodes: 2 }, { maxScalarBytes: 2 }, { maxDocumentBytes: 2 }, { maxOutputBytes: 2 }]) {
    const result = await run(["-p=csv", "-o=json", "."], "name,count\nChangedOne,7\n", {}, { limits });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("limit exceeded"), result.stderr);
  }
});

test("CSV quoted delimiters, newlines and quotes survive conversion", async () => {
  const input = 'name,count\n"Comma, quote "" and\nnewline",7\n';
  assert.deepEqual(await run(["-p=csv", "-o=csv", "."], input), { status: 0, stdout: input, stderr: "" });
});

test("TOML output round trips tables and rejects unrepresentable null entries", async () => {
  const result = await run(["-o=toml", "."], '"a key": "value"\nsection:\n  count: 7\n  values: [1, 2]\n');
  assert.equal(result.status, 0, result.stderr);
  const decoded = await run(["-p=toml", "-o=json", "-I=0", "."], result.stdout);
  assert.deepEqual(decoded, { status: 0, stdout: '{"a key":"value","section":{"count":7,"values":[1,2]}}\n', stderr: "" });
  assert.equal((await run(["-o=toml", "."], "key: null\n")).status, 1);
});

for (const backend of ["memory", "s3"] as const) {
  test(`format conversion reads the configured ${backend} filesystem`, async () => {
    const fs = backend === "memory" ? createMemoryFileSystem() : new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
    const shell = new Shell({ fs }).use(mikeYqCommands());
    try {
      for (const [format, , input, expected] of inputs) {
        await fs.writeFile("/data", Buffer.from(input));
        const result = await shell.exec(`yq -p ${format} -o json -I 0 . /data`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, expected + "\n");
      }
      await fs.writeFile("/data", Buffer.from(mapping));
      const result = await shell.exec(`yq -o csv --split-exp '"result"' '[.]' /data`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(Buffer.from(await fs.readFile("/result.csv")).toString(), "name,count\nChangedOne,7\n");
    } finally { await shell.dispose(); }
  });
}

for (const [limits, diagnostic] of [
  [{ maxDepth: 32 }, "maxDepth"],
  [{ maxParserNodes: 32 }, "maxParserNodes"],
  [{ maxNodes: 32 }, "maxNodes"],
] as const) test(`properties admits ${diagnostic} before building a deep graph`, async context => {
  const create = Object.create;
  let mappings = 0;
  context.mock.method(Object, "create", (...args: Parameters<typeof Object.create>) => {
    if (args[0] === null) mappings++;
    return create(...args);
  });
  const result = await run(["-p=props", "-o=json", "."], "x.".repeat(10000) + "last=ok\n", {}, { limits });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes(`yq limit exceeded: ${diagnostic}`), result.stderr);
  assert.ok(mappings < 100, `allocated ${mappings} maps before rejection`);
});

test("properties rejects a near-document-limit virtual file with an ordinary depth diagnostic", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/payload", Buffer.from("x.".repeat(500000) + "last=ok\n"));
  const shell = new Shell({ fs }).use(mikeYqCommands({ limits: { maxDocumentBytes: 1048576, maxParserNodes: 4096, maxDepth: 128 } }));
  try {
    const result = await shell.exec("yq -p=props -o=json . /payload");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Error: yq limit exceeded: maxDepth\n");
  } finally { await shell.dispose(); }
});

test("properties admits parser nodes across entries before constructing a wide graph", async context => {
  const create = Object.create;
  let mappings = 0;
  context.mock.method(Object, "create", (...args: Parameters<typeof Object.create>) => {
    if (args[0] === null) mappings++;
    return create(...args);
  });
  const input = Array.from({ length: 1000 }, (_, index) => `key${index}.value=ok`).join("\n");
  const result = await run(["-p=props", "-o=json", "."], input, {}, { limits: { maxParserNodes: 32 } });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("yq limit exceeded: maxParserNodes"), result.stderr);
  assert.ok(mappings < 100, `allocated ${mappings} maps before rejection`);
});

test("properties preserves shared paths, replacement, empty components and literal prototype keys", async () => {
  const result = await run(["-p=props", "-o=json", "-I=0", "."], "a.b=one\na.c=two\na.b=three\nx=old\nx.y=new\n.empty=end\n__proto__.safe=yes\n");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { a: { b: "three", c: "two" }, x: { y: "new" }, "": { empty: "end" }, ["__proto__"]: { safe: "yes" } });
});
