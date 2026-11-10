import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick PNGs: default sRGB gamma and explicit linear grayscale gamma.
const fixtures = [
  { name: "in8.png", gamma: "0.454545", base64: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6MDc6NTcrMDA6MDACLvzpAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjA3OjU3KzAwOjAwc3NEVQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzowNzo1NyswMDowMCRmZYoAAAETSURBVBjTAQgB9/4AJXjLHo7hNIf3Sp3wYLMGWckcb8Iyhdgrm+5BlARXqv0AbcATZtYpfM8/kuU4qPtOoRFktwp6zSBz4zaJ3Eyf8kUAtQhbrh5xxBeH2i2A8EOW6Vms/1LCFWi7K37RJJTnOo0A/VCj9ma5DF/PInXIOIveMaH0R5oKXbADc8YZbNwvgtUARZjrPq4BVKcXar0QgNMmeek8j+JSpfhLuw5htCR3yh0AjeAzhvZJnO9fsgVYyBtuwTGE1yqa7UCTA1ap/Gy/EmUA1Sh7zj6R5Den+k2gEGO2CXnMH3LiNYjbS57xRLQHWq0AHXDDFobZLH/vQpXoWKv+UcEUZ7oqfdAjk+Y5jPxPovUcJoEBTbp3hAAAAABJRU5ErkJggg==" },
  { name: "linear.png", gamma: "1", base64: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAQAAABuBnYAAAAABGdBTUEAAYagMeiWXwAAAAJiS0dEAP+Hj8y/AAAAB3RJTUUH6gsHFwg5H7ksGQAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0xMS0wN1QyMzowNzo1NyswMDowMAIu/OkAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMTEtMDdUMjM6MDc6NTcrMDA6MDBzc0RVAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTExLTA3VDIzOjA4OjU3KzAwOjAw1W0+BwAAAJNJREFUCNcBiAB3/wAuHpmHRfBZWSXCOSuvlBn9AGlmLM9GOMehIAp6czXcU0UAG64pF42AP+ljUiG7MySjjQBL9mBfKMg/MbmaHANwbDDVAEw+GackEIN5OeJaSx60LR0CS0grSDNIoUj/SFNI+kg6SAAszkU3xaAgCXlyNNtSRButACgWjH8+6GJRIboyI6GMSvWc4DLzwesuTwAAAABJRU5ErkJggg==" }
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each(fixtures)(`expands gamma for $name via ${mode}`, async ({ base64, gamma }) => {
    const bytes = Buffer.from(base64, "base64");
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", bytes);
    for (const identify of [false, true]) {
      const format = "%[gamma]|%[GAMMA]|%[colorspace]|%[channels]";
      const args = identify ? ["identify", "-format", format, "in.png"] : ["in.png", "-format", format, "info:"];
      const files = new Map([["in.png", bytes]]);
      let result;
      if (mode === "command") {
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const status = await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { ...status, stdout, stderr };
      } else {
        result = mode === "sync" ? runMagickCliSync(args, files)
          : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      }
      expect(result).toEqual({ exitCode: 0, stderr: "", stdout: `${gamma}|${gamma}|${gamma === "1" ? "LinearGray|lineargraya 2.0" : "sRGB|srgba 4.0"}` });
      expect([...await fs.readFile("/in.png")]).toEqual([...bytes]);
    }
  });
}
