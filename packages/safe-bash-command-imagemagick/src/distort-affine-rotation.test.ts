import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";
import fixture from "./distort-affine-rotation-fixture.json" with { type: "json" };

// Native ImageMagick 7.1.2-35 Q16-HDRI reference for the three-pair quarter turn.
it.each(["command", "retained", "buffered"])("%s: rotates Affine at pixel centers", async mode => {
    const input = Buffer.from(fixture.input, "base64");
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", "-filter", "point", "-distort", "Affine", "0,0 14,0 10,0 14,10 0,10 4,0", "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const actual = decodeImage(mode === "buffered" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
    const expected = decodeImage(Buffer.from(fixture.output, "base64"));
    expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
    expect(actual.data).toEqual(expected.data);
});
