import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const input = Uint8Array.from({ length: 48 }, (_, i) => (37 * i + 19) % 256);
// Native ImageMagick 7.1.2-35 Q16-HDRI, default white background.
const spliced = "13385d8200000000a7ccf1163b6085aacff4193e00000000000000000000000000000000000000006388add200000000f71c41668bb0d5fa1f44698eb3d8fd2200000000476c91b6db00254a6f94b9de";
const cases = [
    { name: "region and splice", operations: ["-region", "2x2+1+1", "-splice", "1x1+1+1", "+region"], expected: spliced },
    { name: "splice only", operations: ["-splice", "1x1+1+1"], expected: spliced },
    { name: "region only", operations: ["-region", "2x2+1+1", "+region"], expected: Buffer.from(input).toString("hex") }
];
for (const mode of ["command", "buffered", "retained"]) {
    it.each(cases)(`preserves native CMYK black samples with $name (${mode})`, async ({ operations, expected }) => {
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.raw", input);
        const files = new Map([["in.raw", input]]);
        const args = ["-size", "4x3", "-depth", "8", "cmyk:in.raw", ...operations, "-depth", "8", "cmyk:out"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            expect((await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).exitCode).toBe(0);
        }
        const output = mode === "buffered" ? files.get("out")! : await filesystem.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
