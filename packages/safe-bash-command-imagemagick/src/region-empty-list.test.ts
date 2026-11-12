import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const option of ["-region", "+region"]) {
        const operation = option === "-region" ? [option, "1x1+0+0"] : [option];
        it.each([
            { name: "before input", operands: [...operation, "xc:red"] },
            { name: "empty group", operands: ["xc:red", "(", ...operation, "xc:blue", ")"] },
            { name: "after deletion", operands: ["xc:red", "+delete", ...operation, "xc:blue"] },
            { name: "after input", operands: ["xc:red", ...operation], pixels: [255, 0, 0] },
            { name: "populated group", operands: ["xc:red", "(", "xc:blue", ...operation, ")"], pixels: [255, 0, 0, 0, 0, 255] },
            { name: "cloned parent", operands: ["xc:red", "(", "+clone", ...operation, ")"], pixels: [255, 0, 0, 255, 0, 0] },
        ])(`${mode}: ${option} $name`, async ({ operands, pixels }) => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/out", keep]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", keep);
            const argv = [...operands, "-depth", "8", "rgb:/out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            if (pixels) {
                expect(result.exitCode, stderr).toBe(0);
                expect(stderr).toBe("");
                expect([...output]).toEqual(pixels);
            } else {
                expect(result.exitCode).toBe(1);
                expect(stderr).toContain(`no images found for operation '${option}'`);
                expect(output).toEqual(keep);
            }
        });
    }
}
