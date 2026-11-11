import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Discrete alpha retains stored opacity during shear.
const inputPixels = Buffer.concat([
    Buffer.from("P7\nWIDTH 2\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("2040604020406040a08050c0a08050c0", "hex")
]);
const cases = [
    { input: "xc:#33669980", geometry: "25x0", alpha8: "44803c808000", alpha16: "449480803bec808080800000" },
    { input: "in.pam", geometry: "0x25", alpha8: "7c4066c00000", alpha16: "7c2c404066dfc0c000000000" },
    { input: "xc:#33669980", geometry: "0x0", alpha8: "80808080", alpha16: "8080808080808080" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
    for (const alpha of ["Discrete", "On"])
        for (const compose of ["Over", "Src"])
            for (const depth of [8, 16])
                it.each(cases)(`${mode}: ${alpha} ${compose} shear $geometry at ${depth} bits`, async ({ input, geometry, alpha8, alpha16 }) => {
                    const argv = ["-size", "2x2", input, "-alpha", alpha, "-background", "none", "-compose", compose,
                        "-shear", geometry, "-alpha", "extract", "-depth", String(depth), "-endian", "MSB", "gray:out"];
                    const files = new Map<string, Uint8Array>([["in.pam", inputPixels]]), fs = new MemoryFileSystem();
                    await fs.writeFile("/in.pam", inputPixels);
                    const argumentValues = createCommandArguments(argv);
                    let stdout = "", stderr = "";
                    const result = mode === "command" ? await createMagickCommand().execute({
                        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                    }) : mode === "sync" ? runMagickCliSync(argv, files)
                        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                    expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
                    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
                    expect(Buffer.from(bytes).toString("hex")).toBe(depth === 16 ? alpha16 : alpha8);
                });
