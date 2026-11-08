import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

it("preserves all 16-bit PPM channel bytes when converting to PNG", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.dat", Buffer.from("50360a3220310a36353533350a1234456789abcdef13792468", "hex"));
    const args = createCommandArguments(["in.dat", "out.png"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const png = Buffer.from(await fs.readFile("/out.png"));
    expect(png[24]).toBe(16);
    // Inspect the PNG scanline independently of the image decoder.
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
    }
    const row = inflateSync(Buffer.concat(chunks));
    expect(row[0]).toBe(1); // Sub filter, six bytes per RGB16 pixel.
    for (let index = 7; index < row.length; index++) row[index] = (row[index]! + row[index - 6]!) & 255;
    expect(row.subarray(1).toString("hex")).toBe("1234456789abcdef13792468");
});
