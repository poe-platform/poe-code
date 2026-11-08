import { expect, test } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { sniff } from "../csv/sniffer.js";
import { RowStorage } from "../table/external.js";
import { createReplayFile } from "../table/storage.js";
import { sniffReplay } from "./replay-sniffer.js";

test("external dialect inference preserves quote patterns and frequency modes", async () => {
  const samples = ["", "a,b\n1,2\n", 'a;"multi\nline";c\n1;2;3', '"a","b"\n"c","d"', 'a,"b"\nc,"d"', '"a"\n"b"', 'x, "a""b", y\nz, "c", w', "a|b\nx|y", "a,b;c\nd,e;f", "😀,'a'😀\n😀,'b'😀", "a\rb\r", "a,b\n\n1,2", ",\"a\n'b'\";x", "a b\nx y"];
  let seed = 1729;
  const alphabet = ["a", "b", ",", ";", "|", " ", "\n", '"', "'", "😀", "\r"];
  for (let sample = 0; sample < 80; sample++) {
    let text = "";
    for (let index = 0; index < 35; index++) { seed = (seed * 1664525 + 1013904223) >>> 0; text += alphabet[seed % alphabet.length]; }
    samples.push(text);
  }
  const backing = new MemoryFileSystem();
  const storage = new RowStorage(() => createReplayFile(backing, "/", new AbortController().signal));
  try {
    for (const sample of samples) {
      const source = async function* () { for (const char of sample) yield char; };
      expect(await sniffReplay(source, storage, () => {}), JSON.stringify(sample)).toEqual(sniff(sample));
    }
  } finally { await storage.close(); }
});
