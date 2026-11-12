import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI reference values for the selected intensity method.
const cases = [
    { name: "virtual background intensity", input: ["xc:#a653b580", "-intensity", "Average", "-virtual-pixel", "background", "-background", "#204080"], options: ["-format", "%[fx:p{-2,0}.intensity]", "info:"], text: "0.29281" },
    { name: "Average text and qualified samples", input: ["xc:#a653b580", "-intensity", "Average"], options: ["-format", "%[fx:intensity]|%[fx:u.intensity]|%[fx:p{0.5,0}.intensity]|%[fx:luma]|%[fx:luminance]", "info:"], text: "0.562092|0.562092|0.562092|0.42245|0.42245" },
    { name: "Brightness image", input: ["xc:#a653b580", "-intensity", "Brightness"], options: ["-fx", "intensity", "-channel", "R", "-separate", "-depth", "16", "-endian", "MSB", "gray:-"], hex: "b5b5" },
    { name: "Brightness interpolated image", input: ["xc:#a653b580", "-intensity", "Brightness"], options: ["-fx", "p{0.5,0}.intensity", "-channel", "R", "-separate", "-depth", "16", "-endian", "MSB", "gray:-"], hex: "b5b5" },
    { name: "Rec709Luminance text", input: ["xc:#a653b580", "-intensity", "Rec709Luminance"], options: ["-format", "%[fx:intensity]", "info:"], text: "0.176308" },
    { name: "default intensity", input: ["xc:#a653b580"], options: ["-format", "%[fx:intensity]", "info:"], text: "0.42245" },
    { name: "explicit Rec709Luma", input: ["xc:#a653b580", "-intensity", "Rec709Luma"], options: ["-format", "%[fx:intensity]", "info:"], text: "0.42245" },
    { name: "reset intensity", input: ["xc:#a653b580", "-intensity", "Average", "+intensity"], options: ["-format", "%[fx:intensity]", "info:"], text: "0.42245" },
];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $name`, async fixture => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = [...fixture.input, ...fixture.options], chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
        const output = mode === "command" ? Buffer.concat(chunks)
            : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : "stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
        expect(output.toString(fixture.hex === undefined ? "utf8" : "hex")).toBe(fixture.hex ?? fixture.text);
    });
}
