import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const high = "753075307530ffff752e752e752e80e8752f752f752f9c40";
const sortedHigh = "752e752e752e80e8752f752f752f9c40753075307530ffff";
const low = "d02030302050e000d0203030608040f01122330080808070808080e090102080";
const sortedLow = "d0203030d02030302050e000608040f0112233009010208080808070808080e0";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, including arithmetic controls.
const cases = [
    { name: "fractional 16-bit", depth: 16, operations: ["-intensity", "Average", "-evaluate", "Divide", "257", "-sort-pixels", "-evaluate", "Multiply", "257"], expected: sortedHigh },
    { name: "16-bit identity", depth: 16, operations: ["-intensity", "Average", "-evaluate", "Divide", "1", "-sort-pixels", "-evaluate", "Multiply", "1"], expected: sortedHigh },
    { name: "arithmetic without sorting", depth: 16, operations: ["-intensity", "Average", "-evaluate", "Divide", "257", "-evaluate", "Multiply", "257"], expected: high },
    { name: "above range", depth: 8, operations: ["-evaluate", "Multiply", "3", "-sort-pixels", "-evaluate", "Divide", "3"], expected: sortedLow },
    { name: "fractional 8-bit", depth: 8, operations: ["-evaluate", "Divide", "7", "-sort-pixels", "-evaluate", "Multiply", "7"], expected: sortedLow },
    { name: "negative samples", depth: 8, operations: ["-evaluate", "Subtract", "30%", "-sort-pixels", "-evaluate", "Add", "30%"], expected: sortedLow },
    { name: "unscaled", depth: 8, operations: ["-sort-pixels"], expected: sortedLow }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const { name, depth, operations, expected } of cases) {
        it(`${mode}: sorts and copies ${name} without losing working samples`, async () => {
            const header = `P7\nWIDTH ${depth === 16 ? 3 : 4}\nHEIGHT ${depth === 16 ? 1 : 2}\nDEPTH 4\nMAXVAL ${depth === 16 ? 65535 : 255}\nTUPLTYPE RGB_ALPHA\nENDHDR\n`;
            const input = Uint8Array.from([...new TextEncoder().encode(header), ...Buffer.from(depth === 16 ? high : low, "hex")]);
            const files = new Map([["in.pam", input], ["out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
            const argv = ["in.pam", ...operations, "-depth", String(depth), "-endian", "MSB", "rgba:out"];
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
