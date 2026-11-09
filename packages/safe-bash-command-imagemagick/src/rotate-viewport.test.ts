import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

import fixtures from "./rotate-viewport-fixtures.json" with { type: "json" };

// Native ImageMagick PNG32 output, including page geometry and every RGBA sample.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(fixtures.cases)(`honors rotation viewport $args (${mode})`, async ({ args: options, geometry, pixels }) => {
        const input = Buffer.from(fixtures.input, "base64");
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...options, "PNG32:/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        expect((await runMagickCli(["identify", "-format", "%wx%h %g", "/output.png"], new Map([["/output.png", output]]))).stdout).toBe(geometry);
        expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(pixels);
    });
}
