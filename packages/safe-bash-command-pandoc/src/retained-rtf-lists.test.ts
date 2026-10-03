import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {RetainedRtfSyntax} from "./retained-rtf-syntax.js";
import {RetainedRtfLists} from "./retained-rtf-lists.js";
import {readDocument} from "./index.js";
const bytes = (source: string) => Uint8Array.from(source, char => char.charCodeAt(0));
async function fixture(source: string, run: (lists: RetainedRtfLists) => Promise<void>, prepare?: (context: ExecutionContext, fs: MemoryFileSystem) => void) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("read", {yield: async () => {}});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file reads forbidden"));
  try {
    const syntax = await RetainedRtfSyntax.acquire({bytes: bytes(source)}, context, {fs, directory: "/", cacheBytes: 16384});
    const lists = new RetainedRtfLists(syntax, storage, context);
    prepare?.(context, fs);
    for await (const node of syntax.children(syntax.root)) if ((await syntax.token(node)).kind === "group") await lists.read(node);
    await run(lists);
  } finally {await storage.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
}
const table = (level: string) => String.raw`{\*\listtable{\list{\listlevel` + level + String.raw`}\listid7}}`;
const override = String.raw`{\*\listoverridetable{\listoverride\listid7\listoverridecount0\ls2}}`;
it.each([0, 1, 2, 3, 4, 23])("retains list numbering %i and supported label delimiters", async nfc => {
  for (const label of [String.raw`\'02\'00.;`, String.raw`\'02\'00);`, String.raw`\'03(\'00);`]) {
    const source = String.raw`{\rtf1` + table(`\\levelnfc${nfc}\\levelstartat3{\\leveltext${label}}`) + override + String.raw`\ls2 one\par}`;
    const doc = await readDocument({bytes: bytes(source)}, {from: "rtf"}, {});
    await fixture(source, async lists => {
      const level = (await lists.resolve(2, 0))!;
      const block = doc.blocks[0]!;
      if (block.t === "BulletList") expect(level.style).toBe("bullet");
      else {expect(block.t).toBe("OrderedList"); if (block.t === "OrderedList") expect([level.start, level.style, level.delimiter]).toEqual(block.c[0]);}
      expect(await lists.resolve(2, 1)).toBeUndefined(); expect(await lists.resolve(999, 0)).toBeUndefined();
    });
  }
});
it("merges partial and full level overrides without changing the definition", async () => {
  const source = String.raw`{\rtf1` + table(String.raw`\levelnfc0\levelstartat3`) + String.raw`{\*\listoverridetable{\listoverride\listid7\listoverridecount1{\lfolevel\levelstartat9}\ls2}{\listoverride\listid7\listoverridecount1{\lfolevel{\listlevel\levelnfc23}}\ls3}{\listoverride\listid7\listoverridecount0\ls4}}}`;
  await fixture(source, async lists => {
    expect(await lists.resolve(2, 0)).toEqual({start: 9, style: "Decimal", delimiter: "Period"});
    expect(await lists.resolve(3, 0)).toEqual({start: 1, style: "bullet", delimiter: "Period"});
    expect(await lists.resolve(4, 0)).toEqual({start: 3, style: "Decimal", delimiter: "Period"});
  });
});
it.each([
  table("" ) + table(""),
  String.raw`{\*\listtable{\list\listid7}}`,
  String.raw`{\*\listtable{\list{\listlevel}}}`,
  String.raw`{\*\listtable{\bad\listid7}}`,
  table(String.raw`\levelnfc5`),
  table(String.raw`\levelstartat0`),
  table(String.raw`\unknown`),
  table(String.raw`{\unknown}`),
  table(String.raw`{\leveltext\'02\'00.}`),
  table(String.raw`{\leveltext\'02\'00.;x}`),
  table(String.raw`{\leveltext\'02ab;}`),
  table(String.raw`{\leveltext\u1;}`),
  table(String.raw`{\levelnumbers\u1;}`),
  table(String.raw`x`),
  table(String.raw`{\leveltext\'ff` + "x".repeat(20000) + ";}"),
  String.raw`{\*\listtable{\list` + String.raw`{\listlevel}`.repeat(10) + String.raw`\listid7}}`,
  table("") + String.raw`{\*\listoverridetable{\listoverride\listid7\ls2\listoverridecount1}}`,
  table("") + String.raw`{\*\listoverridetable{\listoverride\listid7\ls2\listoverridecount0{\lfolevel}}}`,
  table("") + String.raw`{\*\listoverridetable{\listoverride\listid7\ls2{\bad}}}`,
  String.raw`{\*\listtable{\list` + String.raw`{\listlevel}`.repeat(9) + String.raw`{\listlevel\unknown}\listid7}}`,
  table("") + String.raw`{\*\listoverridetable{\listoverride\listid7\ls2\listoverridecount9` + String.raw`{\lfolevel}`.repeat(9) + String.raw`{\lfolevel\bad}}}`,
  table("") + override + override
])("preserves list definition errors case %#", async tables => {
  const source = String.raw`{\rtf1` + tables + "}";
  const expected = await readDocument({bytes: bytes(source)}, {from: "rtf"}, {}).catch(error => error);
  expect(expected).toBeInstanceOf(Error);
  await expect(fixture(source, async () => {})).rejects.toMatchObject({code: expected.code, message: expected.message, location: expected.location});
});
it("deduplicates legacy list identities using backed keys", async () => {
  await fixture(String.raw`{\rtf1}`, async lists => {
    const first = await lists.legacy({start: 5, style: "Decimal", delimiter: "OneParen"});
    expect(first).toBe(-1);
    expect(await lists.legacy({start: 5, style: "Decimal", delimiter: "OneParen"})).toBe(first);
    const other = await lists.legacy({start: 5, style: "UpperRoman", delimiter: "OneParen"});
    expect(other).toBe(-2);
    expect(await lists.resolve(first, 0)).toEqual({start: 5, style: "Decimal", delimiter: "OneParen"});
    expect(await lists.resolve(other, 0)).toEqual({start: 5, style: "UpperRoman", delimiter: "OneParen"});
  });
});

it("spills wide catalogs and keeps legacy IDs separate from normal list IDs", async () => {
  const count = 256;
  const source = String.raw`{\rtf1{\*\listtable` + Array.from({length: count}, (_, id) => `{\\list{\\listlevel\\levelstartat${id + 1}}\\listid${id}}`).join("") + String.raw`}{\*\listoverridetable` + Array.from({length: count}, (_, id) => `{\\listoverride\\listid${id}\\listoverridecount0\\ls${id}}`).join("") + "}}";
  await fixture(source, async lists => {
    for (const id of [0, 63, 64, 255]) expect(await lists.resolve(id, 0)).toEqual({start: id + 1, style: "Decimal", delimiter: "Period"});
    for (let start = 1; start <= count; start++) expect(await lists.legacy({start, style: "Decimal", delimiter: "Period"})).toBe(-start);
    expect(await lists.resolve(-count, 0)).toEqual({start: count, style: "Decimal", delimiter: "Period"});
    expect(await lists.resolve(0, 0)).toEqual({start: 1, style: "Decimal", delimiter: "Period"});
  });
});
it.each(["storage", "cancel"])("cleans retained list state after %s failure", async mode => {
  const source = String.raw`{\rtf1{\*\listtable` + Array.from({length: 1024}, (_, id) => `{\\list{\\listlevel}\\listid${id}}`).join("") + "}}";
  await expect(fixture(source, async () => {}, (context, fs) => {
    if (mode === "storage") {
      const open = fs.open.bind(fs);
      vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        const handle = await open(...args); vi.spyOn(handle, "write").mockRejectedValue(new Error("List storage failed")); return handle;
      });
    } else {
      const cooperate = context.cooperate.bind(context); let calls = 0;
      vi.spyOn(context, "cooperate").mockImplementation(async units => {if (++calls === 256) context.fail("E_CANCELLED", "Cancelled lists"); await cooperate(units);});
    }
  })).rejects.toMatchObject(mode === "storage" ? {message: "List storage failed"} : {code: "E_CANCELLED"});
});
