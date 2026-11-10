import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16: gray samples 21845, 9362, 4369, 257, and both
// orders of [21845, 9362]. Ancillary PNG metadata is omitted.
const fixtures = [
  { name: "q2", colors: 1, depth: 2, png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAYAAABPhRjKAAAADUlEQVQI12MIBYP//wEN+wP9lVpnjQAAAABJRU5ErkJggg==" },
  { name: "q3", colors: 1, depth: 16, png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAYAAABPhRjKAAAAD0lEQVQI12NQmQSC//8DAA4cBCGzjRprAAAAAElFTkSuQmCC" },
  { name: "q4", colors: 1, depth: 4, png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAYAAABPhRjKAAAADUlEQVQI12MQBIP//wEFNwJlDJbfLgAAAABJRU5ErkJggg==" },
  { name: "q8", colors: 1, depth: 8, png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAYAAABPhRjKAAAADUlEQVQI12NgBIP//wEDJwIFjiDHQgAAAABJRU5ErkJggg==" },
  { name: "mixed", colors: 2, depth: 16, png: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAGUlEQVQI12MMDQ0NDQ39//+87Xnb87YMDABAFQcicnFligAAAABJRU5ErkJggg==" },
  { name: "mixedrev", colors: 2, depth: 16, png: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAGklEQVQI12NUmaQySWXS//+Ghw0PGx5mYAAAPhQG/n00KLMAAAAASUVORK5CYII=" }
];

for (const { name, colors, depth, png } of fixtures) {
  it(`reports exact effective depth for ${name} without changing source pixels`, async () => {
    const bytes = new Uint8Array(Buffer.from(png, "base64"));
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    const format = "%k|%[type]|%z|%[bit-depth]";
    const expected = `${colors}|GrayscaleAlpha|16|${depth}`;
    for (const command of [createIdentifyCommand(), createMagickCommand()]) {
      const argumentValues = createCommandArguments(command.name === "identify"
        ? ["-format", format, "/input.png"]
        : ["/input.png", "-format", format, "info:"]);
      let stdout = "", stderr = "";
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect({ ...result, stdout: stdout.trimEnd(), stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
      expect(await fs.readFile("/input.png")).toEqual(bytes);
    }
    const files = new Map([["/input.png", bytes]]);
    expect(await runIdentifyCli(["-format", format, "/input.png"], files))
      .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    expect(runMagickCliSync(["/input.png", "-format", format, "info:"], files))
      .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
}
