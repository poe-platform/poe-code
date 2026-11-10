import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const operation of [["-crop", "2x1+1+0"], ["-trim"]]) {
        it.each([
            { width: 1, clear: false }, { width: 2, clear: false },
            { width: 4, clear: false }, { width: 1, clear: true },
        ])(`${mode} ${operation[0]} beyond a $width-pixel mask (clear=$clear)`, async ({ width, clear }) => {
            const mask = Buffer.concat([Buffer.from(`P5\n${width} 1\n255\n`), Buffer.alloc(width, 255)]);
            const files = new Map([["/mask.pgm", mask]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/mask.pgm", mask);
            const args = ["xc:#d010a040", "xc:#60606090", "xc:#109090c0", "xc:#d010a040", "+append",
                "-read-mask", "/mask.pgm", ...(clear ? ["+read-mask"] : []), ...operation,
                "+read-mask", "-depth", "16", "-endian", "MSB", mode === "command" ? "rgba:-" : "rgba:/out"];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
            const output = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            // Native ImageMagick 7.1.2-35 Q16-HDRI, full RGBA16 output.
            expect(Buffer.from(output).toString("hex")).toBe("6060606060609090101090909090c0c0");
        });
    }
}
