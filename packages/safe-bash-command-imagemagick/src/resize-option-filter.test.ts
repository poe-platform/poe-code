import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i))]);
// Native ImageMagick 7.1.2-35 Q16-HDRI output hashes.
const defaultFilter = "85816f339387d0e9701d68437c4d06645faf0161e5730bd4af74b927e34a3ed3";
const point = "91714c1da5bf421338228eb61b66217fb19079db8619561df9a23809f0e1d8e8";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "unset", inputs: [], expected: defaultFilter },
        { name: "direct option", inputs: ["-filter", "point"], expected: point },
        { name: "unqualified property", inputs: ["-set", "filter", "point"], expected: defaultFilter },
        { name: "qualified option", inputs: ["-set", "option:filter", "point"], expected: point }
    ])(`resizes with $name (${mode})`, async ({ inputs, expected }) => {
        const files = new Map([["in.ppm", input], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const args = ["in.ppm", ...inputs, "-resize", "8x6", "-depth", "8", "rgb:out"];
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
        expect(output.byteLength).toBe(144);
        expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
    });
}
