import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// ImageMagick 7: 4x2 RGB/RGBA PNGs converted to QOI. Native ffprobe reports
// qoi,4,2,rgb24 and qoi,4,2,rgba for these independently encoded files.
const fixtures = [
  { pixFmt: "rgb24", hex: "716f696600000004000000020300fe1234567fc0feabcdef0900fe808080fe0000000000000000000001" },
  { pixFmt: "rgba", hex: "716f696600000004000000020400fe1234567fc0ffabcdef8009ffabcdef00ff808080fffe0000000000000000000001" }
];

for (const filename of ["/input.qoi", "/input.bin", "-"]) {
  it.each(fixtures)(`probes native $pixFmt QOI from ${filename}`, async ({ pixFmt, hex }) => {
    const bytes = Buffer.from(hex, "hex");
    const fs = new MemoryFileSystem();
    if (filename !== "-") await fs.writeFile(filename, bytes);
    const args = ["-v", "error", "-show_entries", "stream=codec_name,width,height,pix_fmt", "-of", "csv=p=0", filename];
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (filename === "-") yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(output).toBe(`qoi,4,2,${pixFmt}\n`);
    expect(evalSyncFfprobe(filename === "-" ? bytes : undefined, args, () => bytes)).toBe(output);
  });
}
