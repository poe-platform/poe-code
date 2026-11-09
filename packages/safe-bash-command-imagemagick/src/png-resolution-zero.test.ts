import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

function chunks(bytes: Uint8Array) {
  const result = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0);
    result.push({ name: new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)),
      data: bytes.slice(offset + 8, offset + 8 + length), bytes: bytes.slice(offset, offset + length + 12) });
    offset += length + 12;
  }
  return result;
}

for (const mode of ["buffered", "command"] as const) {
  // Independent PNG fixtures with valid CRCs and zero or nonzero axis densities.
  it.each([
    ["zeroX", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAAAAAAD6AF+hNEZAAAADElEQVR4nGMQVDIGAACuAGcVHqFfAAAAAElFTkSuQmCC"],
    ["control", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAH0AGl7UZMAAAADElEQVR4nGMQVDIGAACuAGcVHqFfAAAAAElFTkSuQmCC"],
    ["zeroY", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAAAAEhmpXWAAAADElEQVR4nGMQVDIGAACuAGcVHqFfAAAAAElFTkSuQmCC"]
  ])(`omits PNG resolution when either axis is zero (%s, ${mode})`, async (variant, encoded) => {
    const input = new Uint8Array(Buffer.from(encoded!, "base64"));
    const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
    await fs.writeFile("/input.png", input);
    const args = ["/input.png", "/output.png"];
    let stderr = "";
    const result = mode === "buffered" ? await runConvertCli(args, files)
      : await createMagickCommand().execute({ command: "magick", args: createCommandArguments(args).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } } });
    expect(result.exitCode).toBe(0);
    const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
    expect(chunks(output).filter(chunk => chunk.name === "pHYs").map(chunk => chunk.data))
      .toEqual(variant === "control" ? [Uint8Array.of(0, 0, 3, 232, 0, 0, 7, 208, 1)] : []);
    expect(decodeImage(output)).toMatchObject({ width: 1, height: 1, data: Uint8Array.of(17, 34, 51, 255) });
    expect("stderr" in result ? result.stderr : stderr).toBe("");
  });
}
