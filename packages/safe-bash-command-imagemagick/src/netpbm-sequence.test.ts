import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

it.each([
    { args: ["in.dat", "+append", "out.ppm"], expected: "50360a3220310a3235350aff00000000ff" },
    { args: ["in.dat", "-append", "out.ppm"], expected: "50360a3120320a3235350aff00000000ff" },
    { args: ["in.dat[1]", "out.ppm"], expected: "50360a3120310a3235350a0000ff" }
])("preserves concatenated P6 frames for $args", async ({ args: tokens, expected }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.dat", Buffer.from("50360a3120310a3235350aff000050360a3120310a3235350a0000ff", "hex"));
    const args = createCommandArguments(tokens);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(0);
    // Inspect the header and raw RGB bytes independently of the image decoder.
    expect(Buffer.from(await fs.readFile("/out.ppm")).toString("hex")).toBe(expected);
});
