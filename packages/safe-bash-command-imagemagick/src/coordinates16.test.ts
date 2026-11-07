import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// Native ImageMagick PNG48, with four distinct pixels including nonzero low bytes.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACEAIAAACtREYwAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAHdElNRQfqCwcHMw6HkMVeAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA3OjUxOjE0KzAwOjAw6hKasAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwNzo1MToxNCswMDowMJtPIgwAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMDc6NTE6MTQrMDA6MDDMWgPTAAAAI0lEQVQI12MWMgmrmLXn66H+GM1vLIzK5z7MebCOhTnynQgAl78LoZVVY/wAAAAASUVORK5CYII=", "base64");
const colors = [
    [0x1234, 0x5678, 0x9abc, 65535], [0xfedc, 0xba98, 0x7654, 65535],
    [0x1357, 0x2468, 0x369c, 65535], [0xace0, 0xbdf1, 0x2468, 65535], [0, 0, 0, 65535]
];
it.each([
    { options: [], width: 2, height: 2, order: [0, 1, 2, 3] },
    { options: ["-crop", "1x1+1+0"], width: 1, height: 1, order: [1] },
    { options: ["-crop", "1x2+1+0"], width: 1, height: 2, order: [1, 3] },
    { options: ["-chop", "1x0+0+0"], width: 1, height: 2, order: [1, 3] },
    { options: ["-background", "black", "-splice", "1x0+1+0"], width: 3, height: 2, order: [0, 4, 1, 2, 4, 3] },
    { options: ["-flop"], width: 2, height: 2, order: [1, 0, 3, 2] },
    { options: ["-flip"], width: 2, height: 2, order: [2, 3, 0, 1] },
    { options: ["-roll", "+1+0"], width: 2, height: 2, order: [1, 0, 3, 2] },
    { options: ["-roll", "+0-1"], width: 2, height: 2, order: [2, 3, 0, 1] },
    { options: ["-rotate", "180"], width: 2, height: 2, order: [3, 2, 1, 0] },
    { options: ["-rotate", "90"], width: 2, height: 2, order: [2, 0, 3, 1] },
    { options: ["-rotate", "270"], width: 2, height: 2, order: [1, 3, 0, 2] },
    { options: ["-transpose"], width: 2, height: 2, order: [0, 2, 1, 3] },
    { options: ["-flop", "-crop", "1x2+0+0", "-flip"], width: 1, height: 2, order: [3, 1] }
])("preserves exact 16-bit coordinates: $options", async ({ options, width, height, order }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = createCommandArguments(["in.png", ...options, "out.png"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const bytes = await fs.readFile("/out.png");
    expect(bytes[24]).toBe(16);
    const image = decodeImage(bytes);
    expect([image.width, image.height]).toEqual([width, height]);
    expect(Array.from(image.data16!)).toEqual(order.flatMap(index => colors[index]!));
});
