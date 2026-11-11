import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: protected channels retain their input samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const repeats of [1, 513])
it.each([
    { name: "enter CMYK", before: [], space: "CMYK", coder: "cmyk", masked: "d46a006c1c599600", unmasked: "d46a006ccf680069" },
    { name: "leave CMYK", before: ["-colorspace", "CMYK"], space: "sRGB", coder: "rgb", masked: "195693cf6800", unmasked: "1956931c5996" },
].flatMap(test => ["active", "cleared", "none"].map(mask => ({ ...test, mask }))))(
    `${mode}, ${repeats} pairs: $name with $mask mask`, async ({ before, space, coder, masked, unmasked, mask }) => {
        const files = new Map([
            ["/in.ppm", Buffer.concat([Buffer.from(`P6\n${repeats * 2} 1\n255\n`), Buffer.from("1956931c5996".repeat(repeats), "hex")])],
            ["/mask.pgm", Buffer.concat([Buffer.from(`P5\n${repeats * 2} 1\n255\n`), Buffer.from("00ff".repeat(repeats), "hex")])],
        ]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.ppm", ...before, ...(mask === "none" ? [] : ["-write-mask", "/mask.pgm"]),
            ...(mask === "cleared" ? ["+write-mask"] : []), "-colorspace", space,
            ...(mask === "active" ? ["+write-mask"] : []), "-depth", "8", `${coder}:/out`];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe((mask === "active" ? masked : unmasked).repeat(repeats));
    });
