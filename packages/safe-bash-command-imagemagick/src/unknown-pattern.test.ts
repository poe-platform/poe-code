import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

it.each(["not-a-pattern", "", "checkerboard"])("validates pattern:%s before replacing the destination", async (name) => {
    const fs = new MemoryFileSystem();
    const original = new TextEncoder().encode("keep");
    await fs.writeFile("/out.png", original);
    const args = createCommandArguments(["-size", "32x17", `pattern:${name}`, "out.png"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }, fs
    });
    const output = await fs.readFile("/out.png");
    if (name === "checkerboard") {
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const image = decodeImage(output);
        expect([image.width, image.height]).toEqual([32, 17]);
    } else {
        expect(result.exitCode).toBe(1);
        expect(stderr).toContain("unrecognized image format");
        expect(output).toEqual(original);
    }
});
