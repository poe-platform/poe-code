import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, big-endian RGBA16.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "literal Set", setup: [], operator: "Set", operand: "8192", expected: "20005c5caaaa8080" },
        { name: "literal percent", setup: [], operator: "Set", operand: "20%", expected: "33335c5caaaa8080" },
        { name: "FX Set", setup: [], operator: "Set", operand: "%[fx:8192]", expected: "20005c5caaaa8080" },
        { name: "defined option", setup: ["-define", "amount=8192"], operator: "Set", operand: "%[option:amount]", expected: "20005c5caaaa8080" },
        { name: "image property", setup: ["-set", "amount", "8192"], operator: "Set", operand: "%[amount]", expected: "20005c5caaaa8080" },
        { name: "FX percent suffix", setup: [], operator: "Set", operand: "%[fx:20]%", expected: "33335c5caaaa8080" },
        { name: "option percent", setup: ["-define", "amount=20%"], operator: "Set", operand: "%[option:amount]", expected: "33335c5caaaa8080" },
        { name: "FX Add", setup: [], operator: "Add", operand: "%[fx:8192]", expected: "54345c5caaaa8080" },
        { name: "invalid expanded value", setup: ["-define", "amount=bogus"], operator: "Set", operand: "%[option:amount]", expected: undefined },
    ])(`${mode}: $name`, async ({ setup, operator, operand, expected }) => {
        const original = new TextEncoder().encode("keep");
        const files = new Map<string, Uint8Array>([["/out", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", original);
        const argv = ["xc:#345caa80", ...setup, "-channel", "R", "-evaluate", operator, operand,
            "+channel", "-depth", "16", "-endian", "MSB", "rgba:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const error = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(result.exitCode, error).toBe(expected === undefined ? 1 : 0);
        if (expected === undefined) {
            expect(error).toContain("invalid argument '-evaluate' 'bogus'");
            expect(output).toEqual(original);
        } else {
            expect(error).toBe("");
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        }
    });
}

for (const mode of ["retained", "sync"] as const) {
    it.each([
        { name: "per-image dimensions", input: ["xc:#345caa80", "-size", "2x1", "xc:#345caa80", "-channel", "R"], operand: "%[fx:w*8192]", after: ["+append"], expected: "20005c5caaaa808040005c5caaaa808040005c5caaaa8080" },
        { name: "short image property", input: ["xc:#345caa80", "-channel", "R"], operand: "%w", after: [], expected: "00015c5caaaa8080" },
        { name: "per-image channel masks", input: ["xc:#345caa80", "-channel", "R", "(", "xc:#345caa80", "-channel", "G", ")"], operand: "%[fx:8192]", after: ["+append"], expected: "20005c5caaaa808034342000aaaa8080" },
        { name: "current pixels", input: ["xc:#345caa80", "-channel", "R", "-evaluate", "Set", "8192"], operand: "%[fx:mean.r*65535*2]", after: [], expected: "40005c5caaaa8080" },
        { name: "selected meta channel", input: ["xc:#404040", "-duplicate", "4", "-combine", "-channel", "Meta0"], operand: "%[fx:8192]", after: ["-channel", "Meta0", "-separate"], expected: "200020002000ffff" },
        { name: "unselected meta channel", input: ["xc:#404040", "-duplicate", "4", "-combine", "-channel", "R"], operand: "%[fx:8192]", after: ["-channel", "Meta0", "-separate"], expected: "404040404040ffff" },
    ])(`${mode}: expands against $name`, async ({ input, operand, after, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = [...input, "-evaluate", "Set", operand, "+channel", ...after,
            "-depth", "16", "-endian", "MSB", "rgba:/out"];
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        const output = mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
