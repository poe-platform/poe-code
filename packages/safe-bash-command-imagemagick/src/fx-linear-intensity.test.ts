import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI reference output.
const cases = [
    { name: "linear RGB default", options: ["-colorspace", "RGB"], text: "0.42245" },
    { name: "linear gray default", options: ["-colorspace", "LinearGray"], text: "0.456917" },
    { name: "explicit linear luminance", options: ["-colorspace", "RGB", "-intensity", "Rec709Luminance"], text: "0.176308" },
    { name: "sRGB default", options: [], text: "0.42245" },
].flatMap(fixture => [
    ...["intensity", "p{0,0}.intensity"].map(expression => ({
        ...fixture, name: `${fixture.name}: ${expression}`, input: ["xc:#a653b580"],
        options: [...fixture.options, "-format", `%[fx:${expression}]`, "info:"], hex: undefined,
    })),
    ...(fixture.name === "linear RGB default" ? [{
        name: "linear RGB FX pixels", input: ["xc:#a653b580"], text: undefined,
        options: [...fixture.options, "-fx", "intensity", "-channel", "R", "-separate", "-depth", "16", "-endian", "MSB", "gray:-"], hex: "6c25",
    }] : []),
]);
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
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr || ("stderr" in result && typeof result.stderr === "string" ? result.stderr : "")).toMatchObject({ exitCode: 0 });
        const output = mode === "command" ? Buffer.concat(chunks)
            : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : "stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
        expect(output.toString(fixture.hex === undefined ? "utf8" : "hex")).toBe(fixture.hex ?? fixture.text);
    });
}
