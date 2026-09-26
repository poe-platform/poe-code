import { expect, test } from "vitest";
import { readCsvStream } from "../csv.js";
import { LazyInput } from "./index.js";
import { defaultSniffStreamProfile } from "../csv/sniffer-profile.js";
import { utf8Codec } from "../codecs/utf8.js";

function fixture(chunks: string[], borrowed = false) {
  let opens = 0, closes = 0;
  const input = new LazyInput("sample", () => ({ async *[Symbol.asyncIterator]() {
    opens++;
    try { for (const chunk of chunks) yield new TextEncoder().encode(chunk); }
    finally { closes++; }
  } }), utf8Codec, "utf-8", new AbortController().signal, () => {}, () => {}, borrowed);
  return { input, counts: () => ({ opens, closes }) };
}
const profile = { ...defaultSniffStreamProfile, name: "fixture-four-byte-utf8-ignore", peekBytes: 4 };

test("named samples count Python codepoints, normalize newlines and retain the cursor", async () => {
  const { input } = fixture(["😀;\r", "\nx;y\r\n"]);
  expect(await input.sniffSample(3, 20)).toBe("😀;\n");
  expect(await input.read()).toBe("😀;\nx;y\n");
});
test("borrowed fixed peek is independent of chunks and retains all original bytes", async () => {
  for (const chunks of [["é,é\n1,2\n"], ["é", ",", "é", "\n1,2\n"]]) {
    const { input, counts } = fixture(chunks, true);
    expect(await input.sniffSample(100, 20, profile)).toBe("é,");
    expect(await input.read()).toBe("é,é\n1,2\n");
    expect(counts()).toEqual({ opens: 1, closes: 1 });
  }
});
test("disabled sniffing does not open a stream", async () => {
  const { input, counts } = fixture(["a,b"]);
  expect(await input.sniffSample(0, 0)).toBe("");
  expect(counts().opens).toBe(0);
});
test("entire-file sniffing is separately bounded and preserves the full text", async () => {
  const { input } = fixture(["😀,a\n", "1,2\n"]);
  expect(await input.sniffSample(-1, 8)).toBe("😀,a\n1,2\n");
  expect(await input.read()).toBe("😀,a\n1,2\n");
  const exceeded = fixture(["a,b\n1,2\n"]).input;
  await expect(exceeded.sniffSample(-1, 7)).rejects.toThrow("sniff sample character budget");
  await exceeded.close();
});
test("borrowed positive sniff defaults to frozen profile and rejects decoded-cursor ambiguity", async () => {
  const { input } = fixture(["a,b\n1,2\n"], true);
  expect(await input.sniffSample(10, 20)).toBe("a,b\n1,2\n");
  await input.nextLine();
  await expect(input.sniffSample(10, 20, profile)).rejects.toThrow("decoded stdin cursor");
  await input.close();
});
test("closing after peeking returns the original producer once", async () => {
  const { input, counts } = fixture(["a,b\n", "1,2\n"], true);
  await input.sniffSample(2, 20, { ...profile, peekBytes: 2 });
  await input.close(); await input.close();
  expect(counts()).toEqual({ opens: 1, closes: 1 });
});

test("frozen UTF8 ignore preserves actual replacement characters and ignores invalid sequences", async () => {
  const bytes = Uint8Array.from([0xef, 0xbf, 0xbd, 0xc3, 0x28, 0xed, 0xa0, 0x80, 0xf0, 0x9f]);
  expect(await defaultSniffStreamProfile.decode(bytes, "utf-8", new AbortController().signal)).toBe("\ufffd(");
  const bom = Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]);
  expect(await defaultSniffStreamProfile.decode(bom, "utf-8-sig", new AbortController().signal)).toBe("a");
  expect(await defaultSniffStreamProfile.decode(bom, "utf-8", new AbortController().signal)).toBe("\ufeffa");
});
test("empty samples do not consume or resurrect the original source", async () => {
  for (const borrowed of [false, true]) {
    const { input, counts } = fixture([], borrowed);
    expect(await input.sniffSample(20, 20)).toBe("");
    expect(await input.read()).toBe("");
    expect(counts()).toEqual({ opens: 1, closes: 1 });
  }
});
test("named sniff after skipped physical lines samples the remaining cursor", async () => {
  const { input } = fixture(["comment\r\n😀;x\r\n1;2\r\n"]);
  expect(await input.nextLine()).toBe("comment\n");
  expect(await input.sniffSample(3, 20)).toBe("😀;x");
  expect(await input.read()).toBe("😀;x\n1;2\n");
});

test("borrowed peek retention accounting is independent of transport chunk count", async () => {
  const totals: number[] = [];
  for (const chunks of [["a".repeat(1000)], Array.from({ length: 1000 }, () => "a")]) {
    let retained = 0;
    const input = new LazyInput("stdin", () => ({ async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield new TextEncoder().encode(chunk);
    } }), utf8Codec, "utf-8", new AbortController().signal, size => { retained += size; }, () => {}, true);
    expect(await input.sniffSample(1000, 1000, { ...profile, peekBytes: 1000 })).toBe("a".repeat(1000));
    totals.push(retained);
    await input.close();
  }
  // Original byte copies + joined peek + decoded UTF16 + returned UTF16 sample.
  expect(totals).toEqual([6000, 6000]);
});

test("entire borrowed sniff keeps StringIO LF-only iteration and CPython bare-CR error", async () => {
  const { input } = fixture(["a,b\r1,2\r"], true);
  expect(await input.sniffSample(-1, 20)).toBe("a,b\r1,2\r");
  const rows = readCsvStream(input.lines());
  await expect(rows.next()).rejects.toThrow("Error: new-line character seen in unquoted field - do you need to open the file with newline=''?");
  await input.close();
});
