import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("50360a3420320a3235350aff000000ff000000ffffffff000000ff8000fe0180804080", "hex");
// Native ImageMagick Q16-HDRI references: polarity affects gray, never alpha or RGB.
const cases = [
    ...["gray", "r", "g", "b", "a", "o", "c", "m", "y", "k"].map(coder => ({ coder, interlace: "None", black: "5040", white: "a0b0" })),
    { coder: "graya", interlace: "None", black: "dddf", white: "7775" },
    { coder: "graya", interlace: "Plane", black: "5040f0f0", white: "a0b0f0f0" },
    { coder: "graya", interlace: "Line", black: "50f040f0", white: "a0f0b0f0" },
    { coder: "rgb", interlace: "None", black: "88f01ad0", white: "88f01ad0" },
    { coder: "graya", interlace: "None", black: "e0", white: "40", alpha: true },
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const polarity of [undefined, "min-is-black", "min-is-white", "MIN-IS-WHITE"]) {
        it.each(cases)(`${mode} ${polarity}: $coder $interlace alpha=$alpha`, async test => {
            const args = [...("alpha" in test ? ["xc:#3e3e3e9a", "xc:#69696943", "+append"] : ["/in.ppm"]),
                "-depth", "1", "-endian", "MSB", "-interlace", test.interlace,
                ...(polarity ? ["-define", `quantum:polarity=${polarity}`] : []), `${test.coder}:-`];
            const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const argumentValues = createCommandArguments(args);
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "sync" ? runMagickCliSync(args, files) : mode === "buffered" ? await runMagickCli(args, files) : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.concat(chunks);
            expect(bytes.toString("hex")).toBe(polarity?.toLowerCase() === "min-is-white" ? test.white : test.black);
        });
    }
}
