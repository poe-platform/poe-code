import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./colorize-palette-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI promotes indexed images even at colorize 0.
// Native PNG32 outputs were decoded with magick output.png -depth 8 rgba:-.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const fixture of fixtures.cases) {
        it(`${mode}: ${fixture.source} ${fixture.args.join(" ") || "control"}`, async () => {
            const input = Buffer.from(fixtures.sources[fixture.source as keyof typeof fixtures.sources], "base64");
            const files = new Map<string, Uint8Array>([["/in.png", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const args = ["/in.png", ...fixture.args, "-write", "PNG32:/out.png", "-format", "%r", "info:"];
            let stdout = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            expect(Buffer.from(decodeImage(output).data).toString("base64")).toBe(fixture.rgba);
            expect((mode === "command" ? stdout : ("stdout" in result && typeof result.stdout === "string" ? result.stdout : "")).trim()).toBe(fixture.storage);
        });
    }
}
