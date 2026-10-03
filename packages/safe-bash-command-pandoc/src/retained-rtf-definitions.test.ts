import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {RetainedRtfSyntax} from "./retained-rtf-syntax.js";
import {RetainedRtfDefinitions} from "./retained-rtf-definitions.js";
import {readDocument} from "./index.js";
const bytes = (source: string) => Uint8Array.from(source, char => char.charCodeAt(0));
async function fixture(source: string, run: (definitions: RetainedRtfDefinitions, syntax: RetainedRtfSyntax, context: ExecutionContext, fs: MemoryFileSystem) => Promise<void>) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("read", {yield: async () => {}});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file read forbidden"));
  try {
    const syntax = await RetainedRtfSyntax.acquire({bytes: bytes(source)}, context, {fs, directory: "/", cacheBytes: 16384});
    const definitions = new RetainedRtfDefinitions(syntax, storage, context);
    await run(definitions, syntax, context, fs);
  } finally {await storage.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
}
async function groups(syntax: RetainedRtfSyntax) {
  const result: number[] = [];
  for await (const node of syntax.children(syntax.root)) if ((await syntax.token(node)).kind === "group") result.push(node);
  return result;
}
it.each([
  [String.raw`{\rtf1{\fonttbl{\f0\fnil  Arial ;}{\f1\cpg65001 \'c3\'a9;}}}`, ["Arial", "é"]],
  [String.raw`{\rtf1{\fonttbl\f0\fnil Arial;\f1\fcharset1 Serif;}}`, ["Arial", "Serif"]],
  [String.raw`{\rtf1{\fonttbl{\f0\fnil A\\\{\}\~B;ignored}{\f1\fnil \'80\'81;}}}`, ["A\\{}\u00a0B", "€\u0081"]],
  ["{\\rtf1{\\fonttbl{\\f0 " + "a".repeat(40000) + " ;}{\\f1 " + " ".repeat(20000) + "b" + " ".repeat(20000) + ";}}}", ["a".repeat(40000), "b"]]
])("retains grouped and flat font definitions case %#", async (source, expected) => {
  await fixture(source as string, async (definitions, syntax) => {
    await definitions.read((await groups(syntax))[0]!, {codepage: 1252});
    for (let id = 0; id < 2; id++) {
      const font = (await definitions.font(id))!;
      let name = ""; for await (const part of definitions.text.chunks(font.name)) {expect(part.length).toBeLessThanOrEqual(4096); name += part;}
      expect(name).toBe(expected[id]);
    }
    expect(await definitions.font(100)).toBeUndefined();
  });
});
it("keeps effective default-font decoding and body codepages distinct", async () => {
  await fixture(String.raw`{\rtf1{\fonttbl{\f0\cpg65001 Default;}{\f1\cpg1252 \'c3\'a9;}}}`, async (definitions, syntax) => {
    await definitions.read((await groups(syntax))[0]!, {codepage: 1252, defaultFont: 0});
    const font = (await definitions.font(1))!;
    let name = ""; for await (const part of definitions.text.chunks(font.name)) name += part;
    expect(name).toBe("é"); expect(font.codepage).toBe(1252);
  });
});
it("retains color indexes and stylesheet inheritance in caller storage", async () => {
  await fixture(String.raw`{\rtf1{\colortbl;\red255\green1\blue2;\blue128;}{\stylesheet{\s1\b B;}{\s2\sbasedon1\i I;}{\s3\sbasedon2\snext0\qc Q;}}}`, async (definitions, syntax) => {
    for (const node of await groups(syntax)) await definitions.read(node, {codepage: 1252});
    expect(await definitions.color(0)).toBeUndefined(); expect(await definitions.color(1)).toBe("#ff0102"); expect(await definitions.color(2)).toBe("#000080");
    expect(await definitions.color(3)).toBeUndefined();
    const controls = []; for await (const token of definitions.controls(3)) controls.push(token.name);
    expect(controls).toEqual(["b", "i", "qc"]);
  });
});
it.each([
  String.raw`{\rtf1{\fonttbl{\fnil Arial;}}}`,
  String.raw`{\rtf1{\fonttbl{\f0 Arial;}{\f0 Arial;}}}`,
  String.raw`{\rtf1{\fonttbl\f0 Arial;{\f1 Serif;}}}`,
  String.raw`{\rtf1{\fonttbl{\f0\cpg999 Arial;}}}`,
  String.raw`{\rtf1{\fonttbl{\f0\fcharset2 Arial;}}}`,
  String.raw`{\rtf1{\fonttbl{\f0\bold Arial;}}}`,
  String.raw`{\rtf1{\fonttbl{\f0 Arial}}}`,
  String.raw`{\rtf1{\fonttbl{\f0{nested}Arial;}}}`,
  String.raw`{\rtf1{\fonttbl{\f0\cpg65001 \'c3;}}}`,
  String.raw`{\rtf1{\colortbl;\red256;}}`,
  String.raw`{\rtf1{\colortbl;\red1}}`,
  String.raw`{\rtf1{\colortbl;X;}}`,
  String.raw`{\rtf1{\colortbl;\foo1;}}`,
  String.raw`{\rtf1{\stylesheet{\s1\b B;}{\s1\i I;}}}`,
  String.raw`{\rtf1{\stylesheet{\s1\unknown B;}}}`,
  String.raw`{\rtf1{\stylesheet{\s1{nested}}}}`,
  String.raw`{\rtf1{\stylesheet{\sbasedon1 Bad;}}}`
])("preserves definition errors: %s", async source => {
  const expected = await readDocument({bytes: bytes(source)}, {from: "rtf"}, {}).catch(error => error);
  expect(expected).toBeInstanceOf(Error);
  await fixture(source, async (definitions, syntax) => {
    await expect(definitions.read((await groups(syntax))[0]!, {codepage: 1252})).rejects.toMatchObject({code: expected.code, message: expected.message, location: expected.location});
  });
});
it.each(["cycle", "missing", "self", "default"])("preserves %s stylesheet behavior", async mode => {
  const source = String.raw`{\rtf1{\stylesheet{\s1\sbasedon2\b B;}{\s2\sbasedon1\i I;}{\s3\sbasedon3\ul U;}}}`;
  await fixture(source, async (definitions, syntax) => {
    await definitions.read((await groups(syntax))[0]!, {codepage: 1252});
    const read = async (id: number) => {const result = []; for await (const token of definitions.controls(id)) result.push(token.name); return result;};
    if (mode === "cycle") await expect(read(1)).rejects.toMatchObject({code: "E_PARSE", message: "Cyclic RTF stylesheet"});
    else if (mode === "missing") await expect(read(99)).rejects.toMatchObject({code: "E_PARSE", message: "Undefined RTF style 99"});
    else expect(await read(mode === "self" ? 3 : 0)).toEqual(mode === "self" ? ["ul"] : []);
  });
});

it("retains large definition catalogs and traverses deep style ancestry without resident stacks", async () => {
  const count = 256;
  const source = "{\\rtf1{\\fonttbl" + Array.from({length: count}, (_, id) => `{\\f${id} Font ${id};}`).join("") + "}{\\stylesheet" + Array.from({length: count}, (_, id) => `{\\s${id + 1}${id ? `\\sbasedon${id}` : ""}\\fs${id + 1} Style;}`).join("") + "}}";
  await fixture(source, async (definitions, syntax) => {
    for (const node of await groups(syntax)) await definitions.read(node, {codepage: 1252});
    expect(await definitions.font(count - 1)).toBeDefined();
    let index = 0; for await (const token of definitions.controls(count)) expect(token.parameter).toBe(++index);
    expect(index).toBe(count);
  });
});
it.each(["storage", "cancel"])("releases backed definitions after %s failure", async mode => {
  await fixture("{\\rtf1{\\fonttbl{\\f0 " + "a".repeat(65536) + ";}}}", async (definitions, syntax, context, fs) => {
    if (mode === "storage") {
      const open = fs.open.bind(fs);
      vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        const handle = await open(...args); vi.spyOn(handle, "write").mockRejectedValue(new Error("Definition storage failed")); return handle;
      });
    } else {
      const cooperate = context.cooperate.bind(context); let count = 0;
      vi.spyOn(context, "cooperate").mockImplementation(async units => {if (++count === 64) context.fail("E_CANCELLED", "Cancelled definitions"); await cooperate(units);});
    }
    await expect(definitions.read((await groups(syntax))[0]!, {codepage: 1252})).rejects.toMatchObject(mode === "storage" ? {message: "Definition storage failed"} : {code: "E_CANCELLED"});
  });
});
