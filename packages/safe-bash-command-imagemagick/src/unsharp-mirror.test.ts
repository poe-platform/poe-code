import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete 243-byte RGB output.
for (const mode of ["public", "sync"] as const)
it.each([
    [[], [], "f9e927986199c64f0d2ec9974a48dcf21ec0972f8b8a36ef2b222a73a6eb0f42"],
    [[], ["-virtual-pixel", "mirror"], "bdca40ff07b35ef0258f99a4e55e44c5bb53e40d8897522d75de36323c3c41b6"],
    [["-virtual-pixel", "mirror"], [], "bdca40ff07b35ef0258f99a4e55e44c5bb53e40d8897522d75de36323c3c41b6"]
] as const)(`matches native unsharp virtual pixels %j %j (${mode})`, async (before, after, expected) => {
    const input = Buffer.concat([Buffer.from("P6\n9 9\n255\n"), Buffer.from(Array.from({ length: 243 }, (_, i) => (i * 71 + 13) % 256))]);
    const files = new Map<string, Uint8Array>([["/image.ppm", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/image.ppm", input);
    const args = [...before, "/image.ppm", ...after, "-unsharp", "2x1+1+0.05", "-depth", "8", "rgb:/out.rgb"];
    const argumentValues = createCommandArguments(args);
    const result = mode === "sync" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    } as unknown as CommandContext);
    expect(result.exitCode).toBe(0);
    const output = mode === "sync" ? files.get("/out.rgb")! : await fs.readFile("/out.rgb");
    expect(output).toHaveLength(243);
    expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
});
