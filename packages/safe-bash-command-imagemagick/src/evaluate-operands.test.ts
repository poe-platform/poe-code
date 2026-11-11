import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, big-endian RGBA16 from xc:#345caa80.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ...["8192", "8192x3", "8192:4", "8192,3", "8192!", "8192/4", "8192 3", "8192.0+1"].map(operand =>
            ({ operator: "Set", operand, red: "2000" })),
        ...["x2", "(8192)"].flatMap(operand => [
            { operator: "Set", operand, red: "0000" },
            { operator: "Add", operand, red: "3434" },
        ]),
        ...["0x2000", "+0x2000", "0x2000x3"].map(operand => ({ operator: "Set", operand, red: "2000" })),
        { operator: "Add", operand: "-0x2000", red: "1434" },
        { operator: "Set", operand: "+0x20%", red: "51ec" },
        ...["50%", "50%x2", "50%!"].map(operand => ({ operator: "Set", operand, red: "8000" })),
        ...["50x2%", "50 %"].map(operand => ({ operator: "Set", operand, red: "0032" })),
        { operator: "Add", operand: "8192x3", red: "5434" },
        { operator: "Subtract", operand: "8192,3", red: "1434" },
        { operator: "Multiply", operand: "2/4", red: "6868" },
        { operator: "Divide", operand: "2:4", red: "1a1a" },
        ...["banana", "8192banana", "8192xbanana", "", " ", "NaN", "Infinity", "50%junk", "1e", "8192e+"].map(operand =>
            ({ operator: "Set", operand, red: undefined })),
    ])(`${mode}: $operator $operand reads the leading scalar and validates geometry`, async ({ operator, operand, red }) => {
        const original = new Uint8Array([1, 2, 3]);
        const files = new Map([["/out", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", original);
        const args = ["xc:#345caa80", "-channel", "R", "-evaluate", operator, operand,
            "+channel", "-depth", "16", "-endian", "MSB", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(result.exitCode).toBe(red === undefined ? 1 : 0);
        if (red === undefined) {
            expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument '-evaluate'");
            expect(output).toEqual(original);
        } else {
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(Buffer.from(output).toString("hex")).toBe(`${red}5c5caaaa8080`);
        }
    });
}
