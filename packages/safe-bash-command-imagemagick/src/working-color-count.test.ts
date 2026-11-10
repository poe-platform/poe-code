import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("aa3355000042e500876543ffaa335501aa335580876543ff0042e500aa3355ff", "hex")
]);
// Native ImageMagick 7.1.2-35 Q16-HDRI counts working samples before clamping.
const cases = [
    { name: "unclamped addition", operations: ["-channel", "RGB", "-evaluate", "add", "100%", "+channel", "-unique-colors"], format: "%w|%k|%[colors]", expected: "6|6|6" },
    { name: "fractional multiplication", operations: ["-channel", "RGB", "-evaluate", "multiply", "0.001", "+channel"], format: "%k|%[colors]", expected: "6|6" },
    { name: "unmodified colors", operations: ["-unique-colors"], format: "%w|%k|%[colors]", expected: "6|6|6" },
    { name: "explicit clamp", operations: ["-channel", "RGB", "-evaluate", "add", "100%", "-clamp", "+channel", "-unique-colors"], format: "%w|%k|%[colors]", expected: "4|4|4" }
];

for (const factor of ["0", "1e-18", "1e-16", "1e-14"]) for (const unique of [false, true]) {
    const count = factor === "1e-14" ? 4 : factor === "1e-16" ? 3 : 2;
    cases.push({ name: `near-equal HDRI ${factor} palette=${unique}`,
        operations: ["-channel", "R", "-evaluate", "multiply", factor, "+channel", ...(unique ? ["-unique-colors"] : [])],
        format: unique ? "%wx%h|%k|%r" : "%k|%[colors]",
        expected: unique ? `${count}x1|${count}|DirectClass sRGB Alpha` : `${count}|${count}` });
}

for (const mode of ["sync", "map", "retained", "command"] as const) for (const fixture of cases) {
    it(`counts ${fixture.name} (${mode})`, async () => {
        const files = new Map([["/im.pam", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/im.pam", input);
        const sources = fixture.name.startsWith("near-equal") ? ["xc:#203040a0", "xc:#213040a0", "xc:#803040a0", "xc:#20304020", "+append"] : ["/im.pam"];
        files.set("/out", Buffer.from("KEEP"));
        await filesystem.writeFile("/out", Buffer.from("KEEP"));
        const args = [...sources, ...fixture.operations, "-format", fixture.format, "info:/out"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
            expect({ ...result, stdout, stderr }).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        }
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(fixture.expected);
    });
}
