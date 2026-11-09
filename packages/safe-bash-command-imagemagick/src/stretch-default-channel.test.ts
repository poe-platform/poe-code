import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./stretch-default-channel-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2-35 Q16-HDRI: in.png [channel] <operation> 5x10% PNG32:out.png,
// followed by out.png -depth 8 rgba:-. The 8x8 input includes varying RGB and alpha.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const { operation, channel, pixels } of fixtures.cases) {
        const selections = channel === "Default"
            ? [[], ["-channel", "Default"], ["-channel", "dEfAuLt"], ["-channel", "R", "-channel", "Default"], ["-channel", "R", "+channel"]]
            : [["-channel", channel]];
        it.each(selections.map(selection => ({ selection })))(`${mode}: ${operation} matches native RGBA with $selection`, async ({ selection }) => {
            const input = Buffer.from(fixtures.input, "base64");
            const files = new Map<string, Uint8Array>([["/input.png", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const argv = ["/input.png", ...selection, operation, "5x10%", "PNG32:/out.png"];
            let stderr = "";
            const result = mode === "command"
                ? await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
                })
                : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained"
                ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect([output.width, output.height]).toEqual([8, 8]);
            expect([...output.data]).toEqual([...Buffer.from(pixels, "base64")]);
        });
    }
}
