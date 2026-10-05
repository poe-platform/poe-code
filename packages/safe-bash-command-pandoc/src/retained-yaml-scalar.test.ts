import {expect, it} from "vitest";
import {parseDocument} from "yaml";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText} from "./retained-source-text.js";
import {BackedText} from "./backed-text.js";
import {decodeRetainedYamlScalar, decodeRetainedYamlBlock, resolveRetainedYamlScalar, RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";

const cases = [
  "plain", "words with spaces", "a\n  b", "a\n  \n  b", "a\n  \n  \n  b", "a  \n  b\t\n  c",
  "'plain'", "''", "'a''b'", "'a  \n  b'", "'a\n  \n  b'", "' leading and trailing '",
  '"plain"', '""', '"a\\nb"', '"a\\\\b\\"c"', '"a\\x41\\u0042\\U0001F600"',
  '"\\0\\a\\b\\e\\f\\n\\r\\t\\v\\N\\_\\L\\P\\ \\/"',
  '"a  \n  b"', '"a\n  \n  b"', '"a\\\n  b"', '"a \\\n  b"', '"a\\\n  \n  b"',
  "'a\r\n  b'", '"a\r\n  b"', '"a\\\r\n  b"', "'😀''value'",
];
async function fixture(token: string, run: (source: RetainedSourceText, output: BackedText, storage: PagedStorage, fs: MemoryFileSystem) => Promise<void>) {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1);
  const source = new RetainedSourceText(input, async () => {}), output = new BackedText(storage, async () => {});
  await source.append([token]);
  try {await run(source, output, storage, fs);} finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
}
it.each(cases)("decodes YAML flow scalar %j with existing semantics", async token => {
  const native = parseDocument(`value: ${token}\n`); expect(native.errors).toEqual([]);
  const expected = native.toJS().value;
  await fixture(token, async (source, output) => {
    const result = await decodeRetainedYamlScalar(source, {start: 0, end: source.length}, output, async () => {});
    let value = ""; for await (const chunk of output.chunks(result)) value += chunk;
    expect(value).toBe(expected);
  });
});
it.each(["'unterminated", '"unterminated', '"\\q"', '"\\x0q"', '"\\u123"', '"\\UFFFFFFFF"'])("rejects invalid YAML token %j", async token => {
  await fixture(token, async (source, output) => {
    await expect(decodeRetainedYamlScalar(source, {start: 0, end: source.length}, output, async () => {})).rejects.toBeInstanceOf(RetainedYamlSyntaxError);
  });
});
it.each(["plain", "single", "double"])("backs a growing %s scalar with fixed output windows", async style => {
  for (const length of [4096, 16384, 65536]) {
    const token = style === "plain" ? "a".repeat(length) : style === "single" ? "'" + "a".repeat(length) + "'" : '"' + "a".repeat(length) + '"';
    await fixture(token, async (source, output, storage) => {
      const append = storage.append.bind(storage); let largest = 0;
      storage.append = async bytes => {largest = Math.max(largest, bytes.length); return append(bytes);};
      const result = await decodeRetainedYamlScalar(source, {start: 0, end: source.length}, output, async () => {});
      let units = 0;
      for await (const chunk of output.chunks(result)) {expect(chunk.length).toBeLessThanOrEqual(4096); expect([...chunk].every(char => char === "a")).toBe(true); units += chunk.length;}
      expect(units).toBe(length); expect(largest).toBeLessThanOrEqual(16384);
    });
  }
});
it("propagates cancellation instead of treating it as invalid YAML", async () => {
  await fixture('"' + "a".repeat(20000) + '"', async (source, output) => {
    const reason = new Error("cancelled"); let calls = 0;
    await expect(decodeRetainedYamlScalar(source, {start: 0, end: source.length}, output, async () => {if (++calls === 3) throw reason;})).rejects.toBe(reason);
  });
});

it.each(["|", "|-", "|+", "|2", "|2-", "|+2", ">", ">-", ">+", ">2", ">2-", ">+2"].flatMap(header => [
  "  first\n  second\n", "  first\n\n  second\n", "  first\n  \n  \n  second\n",
  "  first\n    indented\n  last\n", "  first\n\n    indented\n\n  last\n", "  \n  first\n\n",
  "  first\n    \n", "  \tfirst\n  second\n", "", "\n", "  \n  \n", "  first", "  first\r\n  second\r\n"
].map(body => ({header, body}))))("decodes block scalar $header %#", async ({header, body}) => {
  const token = `${header}\n${body}`, native = parseDocument(`value: ${token}`);
  expect(native.errors).toEqual([]);
  await fixture(token, async (source, output) => {
    const result = await decodeRetainedYamlBlock(source, {start: 0, end: source.length}, 0, output, async () => {});
    let value = ""; for await (const chunk of output.chunks(result)) value += chunk;
    expect(value).toBe(native.toJS().value);
  });
});
it.each(["|0\n  value", "|22\n  value", "|+-\n  value", "|#comment\n  value", "|\n    \n  value", "|2\n value"])("rejects malformed block scalar %j", async token => {
  await fixture(token, async (source, output) => {
    await expect(decodeRetainedYamlBlock(source, {start: 0, end: source.length}, 0, output, async () => {})).rejects.toBeInstanceOf(RetainedYamlSyntaxError);
  });
});

it("preserves generated block folding and collection-relative indentation", async () => {
  let seed = 541, compared = 0;
  const next = (max: number) => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max;};
  for (let index = 0; index < 250; index++) {
    const parent = next(4), header = ["|", "|-", "|+", "|2", ">", ">-", ">+", ">2+"][next(8)]!;
    let body = " ".repeat(parent + 2) + "first\n";
    for (let line = 0, count = next(8); line < count; line++) {
      const indent = parent + 2 + next(3), content = ["", "words", "\ttext", " 😀 ", "  "][next(5)]!;
      body += " ".repeat(indent) + content + "\n";
    }
    const token = header + "\n" + body;
    const native = parseDocument(" ".repeat(parent) + `value: ${token}`); expect(native.errors).toEqual([]);
    await fixture(token, async (source, output) => {
      const result = await decodeRetainedYamlBlock(source, {start: 0, end: source.length}, parent, output, async () => {});
      let value = ""; for await (const chunk of output.chunks(result)) value += chunk;
      expect(value, token).toBe(native.toJS().value); compared++;
    });
  }
  expect(compared).toBe(250);
});
it.each(["|+", ">-"])("backs long block scalar lines and trailing whitespace: %s", async header => {
  const token = header + "\n  " + "a".repeat(65536) + "\n" + "  \n".repeat(10000);
  const expected = parseDocument(`value: ${token}`).toJS().value as string;
  await fixture(token, async (source, output, storage) => {
    const append = storage.append.bind(storage); let largest = 0;
    storage.append = async bytes => {largest = Math.max(largest, bytes.length); return append(bytes);};
    const result = await decodeRetainedYamlBlock(source, {start: 0, end: source.length}, 0, output, async () => {});
    let offset = 0;
    for await (const chunk of output.chunks(result)) {expect(chunk).toBe(expected.slice(offset, offset + chunk.length)); offset += chunk.length;}
    expect(offset).toBe(expected.length); expect(largest).toBeLessThanOrEqual(16384);
  });
});
it("does not reinterpret scratch failures as YAML syntax failures", async () => {
  await fixture('"' + "a".repeat(20000) + '"', async (source, output, storage) => {
    const reason = new Error("backing failed"); storage.append = async () => {throw reason;};
    await expect(decodeRetainedYamlScalar(source, {start: 0, end: source.length}, output, async () => {})).rejects.toBe(reason);
  });
});

it.each(["", "~", "null", "Null", "NULL", "true", "True", "TRUE", "false", "False", "FALSE", "yes", "on", "nUlL",
  "0", "-0", "+0", "000123", "-000123", "0o777", "0xAbCd", "-0x10", "0X10", "0b10", "1_000", "123abc", "1.25", ".25", "+.25", "1.", "1e10", "-1.e-2",
  ".inf", "-.Inf", "+.INF", ".nan", ".NaN", ".NAN", "+.nan", ".iNf", "1e", "+", "0o9", "0xg",
  "0".repeat(20000) + "123", "9".repeat(20000), "1" + "0".repeat(2000) + "e-2000", "0x" + "f".repeat(20000), "0o" + "7".repeat(20000)
])("resolves YAML core scalar %# without collecting its token", async token => {
  const native = parseDocument(`value: ${token}\n`); expect(native.errors).toEqual([]);
  await fixture(token, async (_source, output) => {
    const text = await output.from([token]);
    const result = await resolveRetainedYamlScalar(output, text, async () => {});
    const expected = native.toJS().value;
    if (result.kind === "string") {expect(typeof expected).toBe("string"); let value = ""; for await (const chunk of output.chunks(result.text)) value += chunk; expect(value).toBe(expected);}
    else {expect(result.kind).toBe(expected === null ? "null" : typeof expected); expect(Object.is(result.value, expected)).toBe(true);}
  });
});

it("matches native numeric rounding for generated long mantissas and radix integers", async () => {
  let seed = 911;
  const next = (max: number) => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max;};
  for (let index = 0; index < 200; index++) {
    const radix = [8, 10, 16][next(3)]!; let digits = "";
    for (let count = 1 + next(400); count > 0; count--) digits += next(radix).toString(radix);
    const token = radix === 8 ? "0o" + digits : radix === 16 ? "0x" + digits : (next(2) ? "-" : "") + digits + (next(2) ? "e-" + next(350) : "");
    const expected = parseDocument(`value: ${token}`).toJS().value;
    await fixture(token, async (_source, output) => {
      const result = await resolveRetainedYamlScalar(output, await output.from([token]), async () => {});
      expect(result.kind).toBe("number"); if (result.kind !== "string") expect(Object.is(result.value, expected), token).toBe(true);
    });
  }
});
