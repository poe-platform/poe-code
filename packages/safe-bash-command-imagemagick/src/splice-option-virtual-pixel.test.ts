import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i))]);
// Native ImageMagick 7.1.2-35 Q16-HDRI output hashes.
const edge = "2866d3a4d7f963f656ebf583473a231e33a032a681f362b6a64cadb8c2e7cf94";
const tile = "e228bfa67794b8a8b23ecdfdc6b996a78fd17e642ffd9e6368c999b28a6d9a42";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "unset", inputs: [], expected: edge },
        { name: "direct option", inputs: ["-virtual-pixel", "tile"], expected: tile },
        { name: "unqualified property", inputs: ["-set", "virtual-pixel", "tile"], expected: edge },
        { name: "reset preserves image setting", inputs: ["-set", "option:virtual-pixel", "tile", "+virtual-pixel"], expected: tile },
        { name: "option replaces image setting", inputs: ["-virtual-pixel", "tile", "-set", "option:virtual-pixel", "edge"], expected: edge },
        { name: "unknown option leaves default", inputs: ["-set", "option:virtual-pixel", "bogus"], expected: edge },
        { name: "qualified option", inputs: ["-set", "option:virtual-pixel", "tile"], expected: tile }
    ])(`samples beyond the source edge with $name (${mode})`, async ({ inputs, expected }) => {
        const files = new Map([["in.ppm", input], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const args = ["in.ppm", ...inputs, "-splice", "2x2+5+4", "-depth", "8", "rgb:out"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(output.byteLength).toBe(90);
        expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
    });
}
