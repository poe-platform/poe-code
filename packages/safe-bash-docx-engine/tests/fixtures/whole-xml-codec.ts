import { Volume } from "memfs";
import assert from "node:assert/strict";
import { readArchive, writeArchive } from "../../src/index.js";
import { textContext } from "./text.js";

export type WholeXmlCodec = "utf8" | "utf8bom" | "utf16le" | "utf16be";

/** Encode and independently verify every actual XML member of an authored fixture. */
export async function encodeWholeXmlFixture(input: Uint8Array, codec: WholeXmlCodec): Promise<Uint8Array> {
  const archive = await readArchive(input, textContext);
  const originals = new Map<string, string>();
  const members = archive.members.map(member => {
    if (!member.name.endsWith(".xml") && !member.name.endsWith(".rels")) return member;
    const text = new TextDecoder("utf8", { fatal: true }).decode(member.bytes);
    originals.set(member.name, text);
    let bytes: Uint8Array;
    if (codec === "utf8") bytes = new TextEncoder().encode(text);
    else if (codec === "utf8bom") bytes = new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]));
    else {
      const payload = Buffer.from(text, "utf16le");
      if (codec === "utf16be") payload.swap16();
      bytes = new Uint8Array(Buffer.concat([Buffer.from(codec === "utf16le" ? [0xff, 0xfe] : [0xfe, 0xff]), payload]));
    }
    return { ...member, bytes };
  });
  const memory = Volume.fromJSON({ "/encoded": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { memory.appendFileSync("/encoded", bytes); } }, { order: "input", compression: "store" }, textContext);
  const output = new Uint8Array(memory.readFileSync("/encoded") as Buffer);
  const stored = await readArchive(output, textContext);
  assert.deepEqual(stored.members.map(member => member.name), archive.members.map(member => member.name));
  for (const member of stored.members) {
    const original = originals.get(member.name);
    if (original === undefined) {
      assert.deepEqual(member.bytes, archive.members.find(item => item.name === member.name)!.bytes);
      continue;
    }
    const prefix = codec === "utf8bom" ? [0xef, 0xbb, 0xbf] : codec === "utf16le" ? [0xff, 0xfe] : codec === "utf16be" ? [0xfe, 0xff] : [];
    if (prefix.length) assert.deepEqual([...member.bytes.subarray(0, prefix.length)], prefix);
    else assert.notDeepEqual([...member.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(new TextDecoder(codec === "utf16le" ? "utf-16le" : codec === "utf16be" ? "utf-16be" : "utf8", { fatal: true }).decode(member.bytes), original);
  }
  return output;
}
