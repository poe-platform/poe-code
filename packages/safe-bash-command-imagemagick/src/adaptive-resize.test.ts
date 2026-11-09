import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./adaptive-resize-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2-31 Q16-HDRI outputs for the asymmetric 5x3 RGB input.
for (const fixture of fixtures) for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it(`adaptively resizes ${fixture.name} to ${fixture.geometry} (${mode})`, async () => {
        const input = Buffer.from(fixture.input, "base64");
        const files = new Map([["/input.png", input as Uint8Array]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const run = async (args: string[]) => {
            if (mode !== "public") return mode === "sync" ? runMagickCliSync(args, files)
                : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            return { ...result, stdout, stderr };
        };
        const result = await run(["/input.png", "-adaptive-resize", fixture.geometry, "PNG24:/output.png"]);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" || mode === "public" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect(Buffer.from(output.data.filter((_, index) => index % 4 !== 3)).toString("hex")).toBe(fixture.rgb);
        expect((await run(["identify", "-format", "%wx%h %g", "/output.png"])).stdout).toBe(fixture.page);
    });
}
