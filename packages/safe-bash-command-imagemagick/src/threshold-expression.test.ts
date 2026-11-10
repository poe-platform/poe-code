import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC", "base64");
const keep = new TextEncoder().encode("KEEP");
const modes = ["command", "retained", "buffered", "sync"] as const;

async function run(mode: typeof modes[number], argv: string[]) {
    const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", keep]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = createCommandArguments([...argv, "PNG32:/out.png"]);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runConvertCliSync([...argv, "PNG32:/out.png"], files)
        : await runConvertCli([...argv, "PNG32:/out.png"], mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
    return { result, output };
}

// ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1; decoded RGBA SHA-256.
const operators = [
    { operator: "-random-threshold", first: 20, suffix: "x80%", hash: "0b8748783e85244c21259c816f5548d1733adf829081cb91879d0d44d5e650ef" },
    { operator: "-range-threshold", first: 10, suffix: ",30,60,90%", hash: "0878e7ef50bb9c1fe48e2882db73b0802ed4d5e65e633a101d71bd0b65bd97b7" },
];

for (const mode of modes) {
    for (const { operator, first, suffix, hash } of operators) {
        it(`${mode}: ${operator} expands FX to native pixels`, async () => {
            for (const value of [String(first), `%[fx:${first}]`]) {
                const { result, output } = await run(mode, ["/in.png", "-seed", "17", operator, value + suffix]);
                expect(result.exitCode).toBe(0);
                expect(createHash("sha256").update(decodeImage(output).data).digest("hex")).toBe(hash);
            }
        });

        it.each([
            { before: ["-crop", "4x6+0+0", "+repage"], value: "%[fx:w*2.5]", literal: "10" },
            { before: ["-set", "cut", "20"], value: "%[cut]", literal: "20" },
            { before: ["-set", "option:cut", "20"], value: "%[option:cut]", literal: "20" },
        ])(`${mode}: ${operator} expands current image values: $value $before`, async ({ before, value, literal }) => {
            const outputs: Uint8Array[] = [];
            for (const operand of [literal, value]) {
                const { result, output } = await run(mode, ["/in.png", ...before, "-seed", "17", operator, operand + suffix, "-set", "option:cut", "99"]);
                expect(result.exitCode).toBe(0);
                outputs.push(decodeImage(output).data);
            }
            expect(outputs[1]).toEqual(outputs[0]);
        });

        it(`${mode}: ${operator} evaluates each image separately`, async () => {
            const outputs: Uint8Array[] = [];
            for (const expanded of [false, true]) {
                const args = expanded
                    ? ["/in.png", "(", "/in.png", "-crop", "4x6+0+0", "+repage", ")", operator, "%[fx:w*2.5]" + suffix]
                    : ["(", "/in.png", operator, "20" + suffix, ")", "(", "/in.png", "-crop", "4x6+0+0", "+repage", operator, "10" + suffix, ")"];
                const { result, output } = await run(mode, ["-seed", "17", ...args, "+append"]);
                expect(result.exitCode).toBe(0);
                outputs.push(decodeImage(output).data);
            }
            expect(outputs[1]).toEqual(outputs[0]);
        });

        it.each(["bogus", "Infinity"])(`${mode}: ${operator} preserves output for invalid expanded values: %s`, async value => {
            const { result, output } = await run(mode, ["/in.png", "-set", "option:cut", value, operator, "%[option:cut]" + suffix]);
            expect(result.exitCode).toBe(1);
            expect(output).toEqual(keep);
        });
    }
}
