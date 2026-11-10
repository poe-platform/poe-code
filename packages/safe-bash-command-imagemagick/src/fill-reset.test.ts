import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI point-drawing outputs.
const unchanged = "07305982abd4fd264f78a1caf31c456e97c0e9123b648db6";
const red = "ff0000ffabd4fd264f78a1caf31c456e97c0e9123b648db6";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { fill: ["-fill", "red", "+fill"], expected: unchanged },
        { fill: ["-fill", "none"], expected: unchanged },
        { fill: ["-fill", "red"], expected: red },
        { fill: [], expected: "000000ffabd4fd264f78a1caf31c456e97c0e9123b648db6" },
        { fill: ["+fill"], expected: unchanged },
        { fill: ["+fill", "-fill", "red"], expected: red },
    ])(`${mode}: point drawing with $fill`, async ({ fill, expected }) => {
        const input = Buffer.concat([
            Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
            Buffer.from(Array.from({ length: 24 }, (_, i) => (i * 41 + 7) % 256)),
        ]);
        const files = new Map([["im.pam", input], ["out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const argv = ["im.pam", ...fill, "-draw", "point 0,0", "-depth", "8", "rgba:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, JSON.stringify(result) + stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
