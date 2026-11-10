import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: white mask pixels protect their destinations.
for (const mode of ["command", "buffered", "sync", "retained"])
    for (const colorspace of ["HSL", "Lab", "sRGB"])
        it.each([
            { name: "write mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], expected: "123456123456fedcba" },
            { name: "region", before: ["-region", "1x1+1+0"], after: ["+region"], expected: "123456123456fedcba" },
            { name: "unprotected", before: [], after: [], expected: "fedcba1234568badcf" },
        ])(`${mode} rolls ${colorspace} with $name`, async ({ before, after, expected }) => {
            const mask = Buffer.concat([Buffer.from("P5\n3 1\n255\n"), Buffer.from([255, 0, 255])]);
            const files = new Map<string, Uint8Array>([["/mask.pgm", mask]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/mask.pgm", mask);
            const argv = ["xc:#123456", "xc:#8badcf", "xc:#fedcba", "+append",
                "-colorspace", colorspace, ...before, "-roll", "+1+0", ...after,
                "-colorspace", "sRGB", "-depth", "8", "rgb:/out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(bytes).toString("hex")).toBe(expected);
        });
