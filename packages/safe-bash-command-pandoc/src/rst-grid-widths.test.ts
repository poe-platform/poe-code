import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

it.each([
  {widths: [5, 5], expected: [6 / 72, 6 / 72], percent: 17},
  {widths: [5, 11], expected: [6 / 72, 12 / 72], percent: 25},
  {widths: [39, 39, 19], expected: [40 / 101, 40 / 101, 20 / 101], percent: 99}
])("retains RST grid widths in CLI and SDK output: %j", async ({widths, expected, percent}) => {
  const border = "+" + widths.map(width => "-".repeat(width)).join("+") + "+\n";
  const row = "|" + widths.map(width => " A".padEnd(width)).join("|") + "|\n";
  const header = "+" + widths.map(width => "=".repeat(width)).join("+") + "+\n";
  const bytes = new TextEncoder().encode(border + row + header + row + border);
  let json = "";
  for (const to of ["json", "html"]) {
    const stdout: Uint8Array[] = [];
    expect(await createStandalonePandocCommand().execute({
      args: ["-f", "rst", "-t", to],
      stdin: [bytes], stdout: {write: async chunk => {stdout.push(chunk);}},
      stderr: {write: async () => {}}, signal: new AbortController().signal
    })).toEqual({exitCode: 0});
    const text = new TextDecoder().decode(Buffer.concat(stdout));
    expect(await convert([{bytes}], {from: "rst", to}, {}))
      .toMatchObject({kind: "text", text});
    if (to === "json") {
      json = text;
      expect(JSON.parse(text).blocks[0].c[2]).toEqual(expected.map(c => [{t: "AlignDefault"}, {t: "ColWidth", c}]));
    } else {
      expect(text).toContain(`<table style="width:${percent}%;">`);
      for (const width of expected) expect(text).toContain(`<col style="width: ${Math.trunc(width * 100)}%" />`);
      let retained = "";
      await convertToOutput([{bytes: new TextEncoder().encode(json)}], {from: "json", to}, {
        workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
        output: {async write(chunk) {retained += new TextDecoder().decode(chunk);}, async close() {}, async abort() {}}
      });
      expect(retained).toBe(text);
    }
  }
});
