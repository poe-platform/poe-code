import { expect, it } from "vitest";
import { encodeId3, probeId3Source } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { SourceAudioTags } from "./source-tags.js";

it("replays private tags with long, case-sensitive owners and significant spaces", async () => {
  const owners = ["a".repeat(20000), "com.example.Take", "com.example.take", "empty"];
  const bytes = encodeId3({ title: "Recording  " }, owners.map((owner, i) => {
    const data = Uint8Array.from([...Array.from(owner, char => char.charCodeAt(0)), 0, ...(i === 3 ? [] : [65 + i, 0, 92, 255, 32, 32])]);
    return { type: "PRIV", offset: 0, size: data.length, data };
  }));
  const source = { size: bytes.length, async read(offset: number, length: number) {
    expect(length).toBeLessThanOrEqual(16384);
    return bytes.slice(offset, offset + length);
  } };
  const fs = new MemoryFileSystem(), tags = new SourceAudioTags(source, { fs, cwd: "/", env: {}, signal: new AbortController().signal });
  try {
    await probeId3Source(source, { onTag: span => tags.add(span) });
    const values: Record<string, string> = {};
    for await (const entry of tags.entries()) {
      let text = "";
      for await (const chunk of entry.text()) text += chunk;
      values[entry.key] = text;
    }
    expect(values).toEqual({ title: "Recording", ["id3v2_priv." + owners[0]]: "A\\x00\\x5c\\xff  ",
      "id3v2_priv.com.example.Take": "B\\x00\\x5c\\xff  ", "id3v2_priv.com.example.take": "C\\x00\\x5c\\xff  ", "id3v2_priv.empty": "" });
    expect(tags.count).toBe(5);
  } finally { await tags.close(); }
  expect(await fs.readdir("/")).toEqual([]);
});
