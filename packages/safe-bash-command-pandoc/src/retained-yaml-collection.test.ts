import {expect, it} from "vitest";
import {parseDocument} from "yaml";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedYamlCst} from "./retained-yaml-cst.js";
import {RetainedYamlParser} from "./retained-yaml-parser.js";
import {RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";
import {resolveRetainedYamlEnd, yamlCstSourceLength} from "./retained-yaml-props.js";
import {resolveRetainedYamlCollection} from "./retained-yaml-collection.js";

async function validate(text: string): Promise<number> {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1);
  const source = new RetainedSourceText(input, async () => {}), tree = new RetainedYamlCst(storage, async () => {});
  await source.append([text]);
  let count = 0;
  try {
    const pending: number[] = [];
    for await (const ref of new RetainedYamlParser(source, {start: 0, end: source.length}, tree, async () => {}).parse()) {
      const doc = await tree.get(ref); if (doc.type === "document" && doc.value) pending.push(doc.value);
    }
    while (pending.length) {
      const ref = pending.pop()!, node = await tree.get(ref);
      if (!["block-map", "block-seq", "flow-collection"].includes(node.type!)) {
        if (node.type !== "block-scalar") await resolveRetainedYamlEnd(tree, node.end, node.offset! + yamlCstSourceLength(node), true);
        continue;
      }
      for await (const entry of resolveRetainedYamlCollection(source, tree, ref)) {
        count++;
        if (entry.key?.token) pending.push(entry.key.token);
        if (entry.value?.token) pending.push(entry.value.token);
      }
    }
    return count;
  } finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
}
const cases = [
  "a: 1\nb: 2\n", "a:\n - &x\"value\"\n", "a:\n - !tag\"value\"\n", "a: [1, 2, {x: y}]\n", "a: {x, y: , : z}\n", "a: [foo: bar, ? baz, : value]\n",
  "? [a, b]\n: {x: y}\n", "a:\n - one\n - two\n", "a: {x: 1,}\n", "a: [1,]\n",
  "a: [,1]\n", "a: [1,,2]\n", "a: {,x: 1}\n", "a: {x: 1,,y: 2}\n",
  "a: [1 2]\n", "a: [\"x\" \"y\"]\n", "a: {x: 1 y: 2}\n", "a: [x: 1 y: 2]\n",
  "a: {x: 1\n y: 2}\n", "a: [x\n : y]\n", "a: [\"x\n y\": z]\n",
  "a: {\"x\n y\": z}\n", "a: [a: b\n", "a: {a: b]\n",
  "a: b: c\n", "a:\n b: c\n  d: e\n", "? a\n? b\n", "a\n: b\n",
  "?\n- a\n- b\n: value\n", "a: [\n # comment\n]\n", "a: {\n # comment\n}\n",
  "a:\n - first\n # tail\n", "a:\n b: c\n # tail\n", "a: [x, # tail\n]\n",
  "a: {x: 1, # tail\n}\n", "a: [\"x\"#bad\n]\n",
  "a: {" + "x".repeat(1025) + ": y}\n", "a: [" + "x".repeat(1025) + ": y]\n",
  "x".repeat(1025) + ": y\n", "a: [{x: y}: z]\n", "a: [{x:\n y}: z]\n"
];
it.each(cases)("validates collection syntax like the existing YAML composer: %j", async text => {
  const native = parseDocument(text);
  if (native.errors.length) await expect(validate(text)).rejects.toBeInstanceOf(RetainedYamlSyntaxError);
  else await expect(validate(text)).resolves.toBeGreaterThan(0);
});
it("walks broad and deeply nested collections without materializing source", async () => {
  expect(await validate("a: [" + "word, ".repeat(2000) + "]\n")).toBe(2001);
  expect(await validate("a: " + "[".repeat(300) + "word" + "]".repeat(300) + "\n")).toBe(301);
});
