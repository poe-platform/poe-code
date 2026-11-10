import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from(Array.from({ length: 24 }, (_, i) => (i * 41 + 7) % 256))
]);
// ImageMagick 7.1.2-35 Q16-HDRI, -background red -splice 1x0+4+0 -depth 8 rgba:out.
const tile = "07305982abd4fd264f78a1ca07305982f31c456e97c0e9123b648db6f31c456e";
const edge = "07305982abd4fd264f78a1ca4f78a1caf31c456e97c0e9123b648db63b648db6";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "reset after loading preserves tile", inputs: ["im.pam", "-virtual-pixel", "tile", "+virtual-pixel"], expected: tile },
        { name: "explicit tile", inputs: ["im.pam", "-virtual-pixel", "tile"], expected: tile },
        { name: "default edge", inputs: ["im.pam"], expected: edge },
        { name: "reset before loading uses edge", inputs: ["-virtual-pixel", "tile", "+virtual-pixel", "im.pam"], expected: edge },
        { name: "reset preserves inherited tile", inputs: ["-virtual-pixel", "tile", "im.pam", "+virtual-pixel"], expected: tile },
        { name: "explicit edge replaces tile", inputs: ["im.pam", "-virtual-pixel", "tile", "+virtual-pixel", "-virtual-pixel", "edge"], expected: edge },
        { name: "reset only changes future inputs", inputs: ["im.pam", "-virtual-pixel", "tile", "+virtual-pixel", "im.pam"], expected: tile + edge }
    ])(`splices with the loaded image's virtual pixels: $name (${mode})`, async ({ inputs, expected }) => {
        const files = new Map([["im.pam", input], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const args = [...inputs, "-background", "red", "-splice", "1x0+4+0", "-depth", "8", "rgba:out"];
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
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
