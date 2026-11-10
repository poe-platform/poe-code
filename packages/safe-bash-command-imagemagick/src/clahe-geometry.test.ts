import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI accepts these literal geometry spellings.
for (const mode of ["public", "sync"] as const) {
    it.each(["2x2+16+2", "2x2+16+2!", "2x2+16+2%", "2x2+16+2>", "2x2+16+", "2x2+16-2", "bad", "2x2+16+2>junk", "2x2+16+2+3"])(`matches native CLAHE geometry %s via ${mode}`, async geometry => {
        const args = ["xc:#80562360", "xc:#40a0a0a0", "xc:#9070a0ea", "+append", "-set", "option:g", "2x2+16+2", "-clahe", geometry, "-depth", "8", "rgba:out"];
        const files = new Map([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        let result, stderr = "";
        if (mode === "public") {
            const argumentValues = createCommandArguments(args);
            result = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += Buffer.from(chunk); } } });
        } else {
            result = runConvertCliSync(args, files);
            stderr = result.stderr;
        }
        const invalid = ["bad", "2x2+16+2>junk", "2x2+16+2+3"].includes(geometry);
        expect(result.exitCode, stderr).toBe(invalid ? 1 : 0);
        if (invalid) expect(stderr).toContain("Invalid CLAHE geometry");
        else expect(stderr).toBe("");
        expect(Buffer.from(mode === "public" ? await fs.readFile("/out") : files.get("out")!).toString("hex"))
            .toBe(invalid ? "4b454550" : "9b6e3a60b2ffffa0cface0ea");
    });
}
