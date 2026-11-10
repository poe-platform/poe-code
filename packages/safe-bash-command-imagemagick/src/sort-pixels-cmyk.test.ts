import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const low = "d02030302050e000d0203030608040f01122330080808070808080e090102080";

// ImageMagick 7.1.2-35 Q16-HDRI reference output.
const cases = [
    { name: "CMYK to sRGB", operations: ["-colorspace", "CMYK", "-sort-pixels", "-colorspace", "sRGB"], expected: "608040f02050e000d0203030d020303080808070808080e01122330090102080" },
    { name: "sRGB sorting control", operations: ["-colorspace", "sRGB", "-sort-pixels", "-colorspace", "sRGB"], expected: "d0203030d02030302050e000608040f0112233009010208080808070808080e0" },
    { name: "CMYK black", operations: ["-colorspace", "CMYK", "-sort-pixels", "-channel", "K", "-separate"], expected: "7f7f7fff1f1f1fff2f2f2fff2f2f2fff7f7f7fff7f7f7fffccccccff6f6f6fff" },
    { name: "CMYK alpha", operations: ["-colorspace", "CMYK", "-sort-pixels", "-channel", "A", "-separate"], expected: "f0f0f0ff000000ff303030ff303030ff707070ffe0e0e0ff000000ff808080ff" },
    { name: "unsorted conversion control", operations: ["-colorspace", "CMYK", "-colorspace", "sRGB"], expected: low }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const { name, operations, expected } of cases) {
        it(`${mode}: sorts and copies ${name} with inks and alpha together`, async () => {
            const header = "P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n";
            const input = Uint8Array.from([...new TextEncoder().encode(header), ...Buffer.from(low, "hex")]);
            const files = new Map([["in.pam", input], ["out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
            const argv = ["in.pam", ...operations, "-depth", "8", "-endian", "MSB", "rgba:out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
