import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixture from "./distort-barrel-axes-fixture.json" with { type: "json" };

// Native RGBA fixtures cover separate axes, optional centers and shared-axis forms.
it.each(["command", "retained", "buffered", "sync"])("%s: Barrel axis coefficients and centers match native RGBA", async mode => {
    const input = Buffer.from(fixture.input, "base64");
    for (const sample of fixture.cases) {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-distort", "Barrel", sample.args, "/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const actual = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
        expect([actual.width, actual.height]).toEqual([19, 15]);
        expect(actual.data, sample.args).toEqual(new Uint8Array(Buffer.from(sample.rgba, "base64")));
    }
});
