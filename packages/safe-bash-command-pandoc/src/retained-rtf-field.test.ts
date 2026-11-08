import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {BackedText} from "./backed-text.js";
import {retainedRtfHyperlink} from "./retained-rtf-field.js";
import {readDocument} from "./index.js";
async function compare(instruction: string) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("read", {yield: async () => {}});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1), text = new BackedText(storage, units => context.cooperate(units));
  try {
    const value = await text.from([instruction]);
    const result = await retainedRtfHyperlink(text, value, context).then(async range => {let target = ""; for await (const part of text.chunks(range)) target += part; return target;}).catch(error => error);
    const escaped = instruction.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}");
    const source = String.raw`{\rtf1\ansicpg65001{\field{\*\fldinst ` + escaped + String.raw`}{\fldrslt label}}}`;
    const expected = await readDocument({bytes: new TextEncoder().encode(source)}, {from: "rtf"}, {yield: async () => {}}).catch(error => error);
    if (expected instanceof Error) {
      const error = expected as Error & {code: string; location: string};
      expect(result).toMatchObject({message: error.message, code: error.code, location: error.location});
    } else {
      expect(expected.blocks[0].c[0].t).toBe("Link"); expect(result).toBe(expected.blocks[0].c[0].c[2][0]);
    }
  } finally {await storage.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
}
it.each([
  'HYPERLINK "https://example.test/a"', 'hyperlink "mailto:person@example.test"', 'HYPERLINK ""',
  String.raw`HYPERLINK \l "bookmark"`, String.raw`HYPERLINK "page" \l "bookmark"`,
  'HYPERLINK "a""b"', 'HYPERLINK "unclosed', 'HYPERLINK "https://a" extra',
  'HYPERLINK "file:///private"', 'INCLUDETEXT "private"', '', 'HYPERLINK',
  'HYPERLINK "https://a" a b c d "unclosed', '\u00a0 HYPERLINK "https://a" \u00a0',
  'HYPERLINK "https://a/é😀"', 'HYPERLINK "http:a:b"'
])("preserves inert hyperlink semantics: %s", compare);
it("retains long targets and scans unsupported late schemes without materialization", async () => {
  await compare('HYPERLINK "' + "a".repeat(65537) + '"');
  await compare('HYPERLINK "' + "a".repeat(65537) + ':bad"');
});
