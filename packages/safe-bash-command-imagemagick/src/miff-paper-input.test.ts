import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCliSync } from "./index.js";
import fixtures from "../../image-ast/src/codecs/miff-paper-fixtures.json";

for (const mode of ["command", "sync"] as const) {
    it.each(fixtures)(`${mode}: reads native MIFF paper metadata: $name`, async ({ miff, stdout, rgbaHash }) => {
        const input = Buffer.from(miff, "base64"), fs = new MemoryFileSystem();
        await fs.writeFile("/in.miff", input);
        const files = new Map<string, Uint8Array>([["/in.miff", input]]);
        const args = ["/in.miff", "-depth", "8", "-write", "rgba:/out.raw", "-format", "%wx%h|%g", "info:"];
        let output = "", stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
        expect("stdout" in result ? result.stdout : output).toBe(stdout);
        const pixels = mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
        expect(createHash("sha256").update(pixels).digest("hex")).toBe(rgbaHash);
    });
}
