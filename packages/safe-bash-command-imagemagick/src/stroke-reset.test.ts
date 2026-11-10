import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "map", "sync"] as const)
for (const command of ["magick", "mogrify"]) {
    it.each([
        { stroke: ["-stroke", "red", "+stroke"], red: false },
        { stroke: ["-stroke", "none"], red: false },
        { stroke: ["-stroke", "red"], red: true },
        { stroke: ["+stroke", "-stroke", "red"], red: true },
    ])(`honors rectangle stroke settings (${mode}, ${command}): $stroke`, async ({ stroke, red }) => {
        const pixels = Uint8Array.from({ length: 24 }, (_, i) => (i * 41 + 7) % 256);
        const input = Buffer.concat([
            Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), pixels,
        ]);
        const destination = command === "mogrify" ? "/im.rgba" : "/out";
        const files = new Map<string, Uint8Array>([["/im.pam", input], [destination, Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const options = ["-fill", "none", ...stroke, "-draw", "rectangle 0,0 2,1", "-depth", "8"];
        const argv = command === "mogrify"
            ? ["mogrify", ...options, "-format", "rgba", "/im.pam"]
            : ["/im.pam", ...options, "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
        expect(result.exitCode, JSON.stringify(result) + stderr).toBe(0);
        const output = mode === "command" ? await fs.readFile(destination) : files.get(destination)!;
        // Native ImageMagick 7.1.2-35 Q16-HDRI output for the same PAM and arguments.
        expect(Buffer.from(output).toString("hex")).toBe(red
            ? "ff0000ffff0000ffff0000ffff0000ffff0000ffff0000ff"
            : "07305982abd4fd264f78a1caf31c456e97c0e9123b648db6");
    });
}
