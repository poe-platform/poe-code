import test from "node:test";
import { compare, type NativeCase } from "../stream-format/helpers.js";

function mixedBytes(): Buffer {
  const choices = [32, 32, 32, 32, 9, 8, 10, 13, 0, 255, 97, 122];
  let state = 0x431ab21;
  return Buffer.from(Array.from({ length: 8192 }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return choices[state % choices.length]!;
  }));
}

export const streamCases: readonly { name: string; fixture: NativeCase }[] = [
  ...[[], ["-a"], ["-t3"], ["-t2,5,+3"], ["-t2,5,/3"], ["-t1"]].map(args => ({ name: "unexpand", fixture: { args, input: mixedBytes() } })),
  { name: "unexpand", fixture: { args: ["-a"], input: " ".repeat(131072) + "x\n" } },
  { name: "rev", fixture: { args: [], input: mixedBytes() } },
  { name: "rev", fixture: { args: [], input: "é🙂ab\u0301".repeat(8192), locale: "en_US.UTF-8" } },
  { name: "nl", fixture: { args: ["-ba", "-l3", "-ha", "-fa", "-v-10", "-i3"], input: Buffer.concat([mixedBytes(), Buffer.from("\n\\:\\:\\:\n\n\n\nH\n\\:\\:\nB\n\\:\nF")]) } },
  { name: "nl", fixture: { args: ["-bp^[a-z]*$"], input: "abc\n123\n\na\n".repeat(1024) } },
];
for (const { name, fixture } of streamCases) test(`${name} bounded native mixed-stream ${JSON.stringify(fixture.args)}`, () => compare(name, fixture));
