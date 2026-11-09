import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";
import fixture from "./distort-barrel-center-fixture.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: the 19x15 image has edge-coordinate center 9.5,7.5.
it.each(["command", "retained", "buffered"])("%s: Barrel explicit and default centers match native RGBA", async mode => {
    const input = Buffer.from(fixture.input, "base64");
    const expected = decodeImage(Buffer.from(fixture.output, "base64"));
    for (const center of ["", " 9.5 7.5"]) {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-distort", "Barrel", `0.45 0 0 0.55${center}`, "/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const actual = decodeImage(mode === "buffered" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
        expect([actual.width, actual.height]).toEqual([19, 15]);
        expect(actual.data, `center '${center}'`).toEqual(expected.data);
    }
});
