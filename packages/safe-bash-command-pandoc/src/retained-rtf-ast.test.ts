import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {RetainedRtfAst} from "./retained-rtf-ast.js";
async function fixture(run: (ast: RetainedRtfAst, output: BackedJson, fs: MemoryFileSystem) => Promise<void>, cooperate: () => Promise<void> = async () => {}) {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const storage = new PagedStorage(owner, 1), target = new PagedStorage(owner, 1);
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole reads forbidden"));
  try {await run(new RetainedRtfAst(storage, cooperate), new BackedJson(target, cooperate), fs);}
  finally {await storage.close(); await target.close(); expect(await fs.readdir("/")).toEqual([]);}
}
async function json(tree: BackedJson): Promise<unknown> {
  let text = ""; for await (const bytes of tree.chunks()) text += new TextDecoder().decode(bytes); return JSON.parse(text);
}
it("retains mutable list items while later paragraphs and nested lists arrive", async () => {
  await fixture(async (ast, output) => {
    const blocks = await ast.array(), items = await ast.array(), item = await ast.array();
    await ast.push(items, item); await ast.push(blocks, await ast.tag("BulletList", items));
    const paragraph = await ast.tag("Para", await ast.value([await ast.tag("Str", await ast.value("one"))]));
    await ast.push(item, paragraph);
    const nested = await ast.array(); await ast.push(item, await ast.tag("BulletList", nested));
    await ast.push(nested, await ast.value([await ast.tag("Para", await ast.value([await ast.tag("Str", await ast.value("two"))]))]));
    await ast.write(blocks, output);
    expect(await json(output)).toEqual([{t: "BulletList", c: [[{t: "Para", c: [{t: "Str", c: "one"}]}, {t: "BulletList", c: [[{t: "Para", c: [{t: "Str", c: "two"}]}]]}]]}]);
  });
});
it("trims both ends of inline arrays and coalesces strings through backed text links", async () => {
  await fixture(async (ast, output) => {
    const nodes = await ast.array(), value = await ast.string(await ast.text.from(["a".repeat(8193)]));
    await ast.push(nodes, await ast.tag("Space")); await ast.push(nodes, await ast.tag("Str", value)); await ast.push(nodes, await ast.tag("Space"));
    expect(await ast.name((await ast.edge(nodes))!)).toBe("Space");
    expect(await ast.name((await ast.edge(nodes, true))!)).toBe("Space");
    await ast.remove(nodes); await ast.remove(nodes, true);
    await ast.appendText(value, await ast.text.from(["😀b"]));
    expect(await ast.count(nodes)).toBe(1); await ast.write(nodes, output);
    expect(await json(output)).toEqual([{t: "Str", c: "a".repeat(8193) + "😀b"}]);
  });
});
it("serializes deep retained containers without recursive traversal or a resident node index", async () => {
  await fixture(async (ast, output) => {
    let node = await ast.value(null);
    for (let depth = 0; depth < 2048; depth++) {const parent = await ast.array(); await ast.push(parent, node); node = parent;}
    await ast.write(node, output);
    let count = 0; for await (const bytes of output.chunks()) for (const byte of bytes) if (byte === 91) count++;
    expect(count).toBe(2048);
  });
});
it("preserves fixed Pandoc tuples, enum tags and shared attribute values", async () => {
  await fixture(async (ast, output) => {
    const attr = await ast.value(["", [], []]);
    const value = await ast.value([attr, attr, [await ast.tag("AlignDefault"), await ast.tag("ColWidthDefault")], 1, null]);
    await ast.write(value, output);
    expect(await json(output)).toEqual([["", [], []], ["", [], []], [{t: "AlignDefault"}, {t: "ColWidthDefault"}], 1, null]);
  });
});
it("keeps emptied arrays reusable after removing their final element", async () => {
  await fixture(async (ast, output) => {
    const values = await ast.array(); await ast.push(values, await ast.value("discard")); await ast.remove(values);
    expect(await ast.edge(values)).toBeUndefined(); expect(await ast.edge(values, true)).toBeUndefined();
    await ast.push(values, await ast.value("kept")); await ast.write(values, output);
    expect(await json(output)).toEqual(["kept"]);
  });
});

it("retires backing stores after a target write failure", async () => {
  await expect(fixture(async (ast, output, fs) => {
    const node = await ast.string(await ast.text.from(["x".repeat(65536)]));
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args); vi.spyOn(handle, "write").mockRejectedValue(new Error("Target failed")); return handle;
    });
    await ast.write(node, output);
  })).rejects.toThrow("Target failed");
});
it("cooperates while serializing deep structures and closes backing on cancellation", async () => {
  let cancel = false;
  await expect(fixture(async (ast, output) => {
    let node = await ast.value(1);
    for (let depth = 0; depth < 1024; depth++) {const parent = await ast.array(); await ast.push(parent, node); node = parent;}
    cancel = true; await ast.write(node, output);
  }, async () => {if (cancel) throw new Error("Cancelled AST");})).rejects.toThrow("Cancelled AST");
});

it("copies and edits retained book nodes without changing their originals", async () => {
  await fixture(async (ast, output) => {
    const original = await ast.tag("Div", await ast.value([["id", [], []], [await ast.tag("Para", await ast.value([await ast.tag("Str", await ast.value("note"))]))]]));
    const copy = await ast.clone(original);
    const attr = (await ast.at((await ast.content(copy))!, 0))!;
    await ast.set(attr, 0, await ast.value("changed"));
    expect(await ast.kind(attr)).toBe("array");
    await ast.write(await ast.value([original, copy]), output);
    expect(await json(output)).toEqual([
      {t: "Div", c: [["id", [], []], [{t: "Para", c: [{t: "Str", c: "note"}]}]]},
      {t: "Div", c: [["changed", [], []], [{t: "Para", c: [{t: "Str", c: "note"}]}]]}
    ]);
  });
});

it("walks retained book rewrites with backed continuations and explicit subtree replacement", async () => {
  await fixture(async (ast, output) => {
    const original = await ast.tag("Link", await ast.value([["", [], []], [], ["#note", ""]]));
    const prose = await ast.value([await ast.tag("Para", await ast.value([await ast.tag("Str", await ast.value("note"))]))]);
    const seen: string[] = [];
    await ast.walk(original, async (node, depth, leaving) => {
      const tag = await ast.name(node);
      if (tag) seen.push(`${leaving ? "leave" : "enter"}:${tag}:${depth}`);
      if (!leaving && tag === "Link") {
        await ast.replaceTag(node, "Note", prose);
        return {descend: prose};
      }
    });
    expect(seen).toEqual(["enter:Link:0", "enter:Para:2", "enter:Str:4", "leave:Str:4", "leave:Para:2", "leave:Note:0"]);
    await ast.write(original, output);
    expect(await json(output)).toEqual({t: "Note", c: [{t: "Para", c: [{t: "Str", c: "note"}]}]});
  });
});

it("serializes retained metadata maps with streamed keys", async () => {
  await fixture(async (ast, output) => {
    const metadata = await ast.object();
    await ast.push(metadata, await ast.value([await ast.string(await ast.text.from(["long", " key"])), await ast.tag("MetaString", await ast.value("title"))]));
    await ast.write(await ast.tag("MetaMap", metadata), output);
    expect(await json(output)).toEqual({t: "MetaMap", c: {"long key": {t: "MetaString", c: "title"}}});
  });
});


it("keeps cloned text chains independent when both strings are extended", async () => {
  await fixture(async (ast, output) => {
    const original = await ast.value("source"), copy = await ast.clone(original);
    await ast.appendText(copy, await ast.text.from([" copy"]));
    await ast.appendText(original, await ast.text.from([" original"]));
    await ast.write(await ast.value([original, copy]), output);
    expect(await json(output)).toEqual(["source original", "source copy"]);
  });
});

it("checks cancellation while locating a retained tuple replacement", async () => {
  let cancel = false;
  await expect(fixture(async (ast) => {
    const array = await ast.array(), value = await ast.value(0);
    for (let index = 0; index < 128; index++) await ast.push(array, value);
    cancel = true;
    await ast.set(array, 127, value);
  }, async () => {if (cancel) throw new Error("Cancelled replacement");})).rejects.toThrow("Cancelled replacement");
});

it("checks cancellation before queuing a wide retained subtree", async () => {
  let cancel = false;
  await expect(fixture(async (ast) => {
    const array = await ast.array(), value = await ast.value(0);
    for (let index = 0; index < 128; index++) await ast.push(array, value);
    await ast.walk(array, async (node, _depth, leaving) => {
      if (!leaving && node.position === array.position) cancel = true;
      else throw new Error("Visited after cancellation");
    });
  }, async () => {if (cancel) throw new Error("Cancelled traversal");})).rejects.toThrow("Cancelled traversal");
});
