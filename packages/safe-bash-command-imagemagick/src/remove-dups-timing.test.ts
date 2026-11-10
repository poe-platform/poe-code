import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Native RemoveDuplicateLayers converts the summed milliseconds using the
// preceding frame's tick rate, then stores that count at 100 ticks per second.
for (const mode of ["sync", "command"] as const) {
  it.each([
    { rates: ["4x20", "4x20"], remove: true, ticks: [8, 10], delays: [80, 100] },
    { rates: ["4x20", ""], remove: true, ticks: [8, 10], delays: [80, 100] },
    { rates: ["4x50", "4x50"], remove: true, ticks: [8, 10], delays: [80, 100] },
    { rates: ["4x100", "4x100"], remove: true, ticks: [8, 10], delays: [80, 100] },
    { rates: ["4x20", "4x20", "4x20"], remove: true, ticks: [28, 10], delays: [280, 100] },
    { rates: ["4x20", "7x50"], remove: true, ticks: [6, 10], delays: [60, 100] },
    { rates: ["4x20", "4x20"], remove: false, ticks: [4, 4, 10], delays: [200, 200, 100] },
  ])(`serializes duplicate timing (${mode}): $rates remove=$remove`, async ({ rates, remove, ticks, delays }) => {
    for (const format of ["gif", "miff", "info"]) {
      const fs = new MemoryFileSystem();
      const files = new Map<string, Uint8Array>();
      const args = [...rates.flatMap(rate => rate ? ["-delay", rate, "xc:red"] : ["xc:red"]), "-delay", "10", "xc:blue",
        ...(remove ? ["-layers", "RemoveDups"] : []),
        ...(format === "info" ? ["-format", "%T;"] : []), `${format}:out.${format}`];
      let stderr = "";
      const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
      const bytes = mode === "sync" ? files.get(`out.${format}`)! : await fs.readFile(`/out.${format}`);
      if (format === "info") {
        expect(new TextDecoder().decode(bytes)).toBe(ticks.map(tick => `${tick};`).join(""));
      } else {
        const output = decodeImage(bytes, { animated: true });
        expect(output.delay).toEqual(delays);
        if (format === "gif") expect([...output.data]).toEqual(delays.flatMap((_, i) => i === delays.length - 1 ? [0, 0, 255, 255] : [255, 0, 0, 255]));
        if (format === "gif") expect(output.loop).toBe(0);
        if (format === "miff") {
          const headers = new TextDecoder().decode(bytes).split("id=ImageMagick").slice(1);
          for (let page = 0; page < ticks.length; page++) {
            expect(headers[page]!.split("\f")[0]!.split("\n")).toContain(`delay=${ticks[page]}`);
            expect(decodeImage(bytes, { page })).toMatchObject({ ticksPerSecond: remove || page === ticks.length - 1 ? 100 : 20 });
          }
        }
      }
    }
  });
}
