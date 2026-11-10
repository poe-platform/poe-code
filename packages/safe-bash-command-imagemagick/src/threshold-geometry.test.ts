import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: only the first field sets the cutoff and units.
const pixels = [61000, 6000, 0, 0, 15000, 48000, 10, 11000, 32768, 32767, 32766, 32767,
    50000, 16000, 38000, 32768, 0, 11000, 65535, 65535];
const header = new TextEncoder().encode("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n");
const input = new Uint8Array(header.length + pixels.length * 2);
input.set(header);
pixels.forEach((sample, index) => new DataView(input.buffer).setUint16(header.length + index * 2, sample));
const percentage = [0, 65535, 0, 0, 0];
const absolute = [65535, 65535, 65535, 65535, 65535];
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["50%x20", percentage],
        ["50x20%", absolute],
        ["50%", percentage],
        ["50", absolute],
        ["50%x20%", percentage],
        ["50%,20%", percentage],
        ["50%x", percentage],
        ["50%,", percentage],
        ["50%/", percentage],
        ["50%:", percentage],
        ["50%+20", percentage],
        ["50%+20+10", percentage],
        ["50%!", percentage],
        ["50%>", percentage],
        ["50%<", percentage],
        ["50%^", percentage],
        ["50%@", percentage],
        ["50%#", percentage],
        ["50/20", absolute],
        ["50:20", absolute],
        ["5e+1%x20", percentage],
        ["+50%+20", percentage],
        ["0x32%+20", percentage],
        ["bad", null],
        ["50%junk", null],
        ["50%,bad", null],
        ["50%xjunk", null],
        ["50%+bad", null],
    ] as const)(`${mode} thresholds geometry %s using the first field`, async (threshold, expected) => {
        const destination = new TextEncoder().encode("KEEP");
        const files = new Map([["in.pam", input], ["out", destination]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const argv = ["in.pam", "-threshold", threshold, "PNG64:out"];
        let stdout = "", stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command"
            ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
                registerCleanup() {}, fs: filesystem,
            } as unknown as CommandContext)
            : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(expected ? 0 : 1);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        if (expected) {
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect([...decodeImage(output).data16!]).toEqual(expected.flatMap(value => [value, value, value, value]));
        } else {
            expect("stderr" in result ? result.stderr : stderr).toContain(`invalid argument '-threshold' '${threshold}'`);
            expect(output).toEqual(destination);
        }
    });
}
