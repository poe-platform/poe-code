import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

for (const layout of ["faststart", "interleaved", "fragmented"]) {
  it(`reports native MP4 packet file offsets for ${layout}`, async () => {
    const fixture = new URL(`../../mp4-ast/src/fixtures/packet-positions-${layout}.mp4`, import.meta.url);
    const bytes = readFileSync(fixture);
    const expected = JSON.parse(readFileSync(new URL(`../../mp4-ast/src/fixtures/packet-positions-${layout}.json`, import.meta.url), "utf8"));
    const fs = new MemoryFileSystem();
    await fs.writeFile("/clip.mp4", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(["-v", "error", "-show_packets", "-show_entries", "packet=size,pos:packet_side_data=", "-of", "json", "/clip.mp4"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    const byPosition = (a: { pos: string }, b: { pos: string }) => Number(a.pos) - Number(b.pos);
    expect(JSON.parse(output).packets.sort(byPosition)).toEqual(expected
      .map(({ size, pos }: { size: string; pos: string }) => ({ size, pos })).sort(byPosition));
  });
}
