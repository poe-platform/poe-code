import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./gamma-storage-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: pixel-identical indexed/direct PNGs and full
// native RGBA output before and after red-channel solarize at 40%.
for (const mode of ["public", "buffered", "sync"] as const) {
    for (const input of ["indexed", "direct"] as const) {
        it.each(fixtures.cases)(`${mode}: ${input} storage and pixels after $operation`, async fixture => {
            const source = Buffer.from(fixtures.inputs[input], "base64");
            const files = new Map<string, Uint8Array>([["/in.png", source]]);
            const fs = new MemoryFileSystem();
            if (mode === "public") await fs.writeFile("/in.png", source);
            const args = ["/in.png", ...fixture.operation, "-write", "PNG32:/before.png",
                "-channel", "R", "-solarize", "40%", "-write", "PNG32:/after.png", "-format", "%r", "info:"];
            let stdout = "", stderr = "";
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
            expect(result.exitCode).toBe(0);
            expect(mode === "public" ? stderr : ("stderr" in result ? result.stderr : "")).toBe("");
            const expected = fixture[input];
            const before = mode === "public" ? await fs.readFile("/before.png") : files.get("/before.png")!;
            const after = mode === "public" ? await fs.readFile("/after.png") : files.get("/after.png")!;
            expect([...decodeImage(before).data]).toEqual([...Buffer.from(expected.before, "base64")]);
            expect([...decodeImage(after).data]).toEqual([...Buffer.from(expected.after, "base64")]);
            expect(mode === "public" ? stdout : ("stdout" in result ? result.stdout : "")).toContain(expected.storage);
        });
    }
}
