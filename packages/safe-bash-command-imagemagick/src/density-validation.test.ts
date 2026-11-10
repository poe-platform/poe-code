import { expect, it } from "vitest";
import { readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runCompareCli, runCompareCliSync, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const beforeInput of [false, true]) {
        for (const output of ["/saved.png", "PNG24:-", "info:-"]) {
            it.each(["xyz", "72junk", "100x50", "100,50", "100/50"])(
                `${mode}: density %s beforeInput=${beforeInput} output=${output}`,
                async density => {
                    const keep = new TextEncoder().encode("KEEP");
                    const files = new Map([["/saved.png", keep]]), filesystem = new MemoryFileSystem();
                    await filesystem.writeFile("/saved.png", keep);
                    const options = ["-units", "PixelsPerCentimeter", "-density", density];
                    const args = [...(beforeInput ? [...options, "xc:red"] : ["xc:red", ...options]),
                        "-format", "%x/%y/%U", output];
                    let result;
                    if (mode === "command") {
                        let stdout = "", stderr = "";
                        const status = await createMagickCommand().execute({
                            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                            stdin: (async function* () {})(), signal: new AbortController().signal,
                            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("latin1"); } },
                            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                        });
                        result = { ...status, stdout, stderr };
                    } else result = mode === "sync" ? runMagickCliSync(args, files)
                        : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
                    const saved = mode === "buffered" || mode === "sync" ? files.get("/saved.png")! : await filesystem.readFile("/saved.png");
                    const valid = density.startsWith("100");
                    expect(result.exitCode, result.stderr).toBe(valid ? 0 : 1);
                    if (!valid) {
                        expect(result.stderr).toContain("invalid argument");
                        expect(result.stderr).toContain("-density");
                        expect(result.stderr).toContain(density);
                        expect(result.stdout).toBe("");
                        expect(saved).toEqual(keep);
                    } else {
                        expect(result.stderr).toBe("");
                        if (output === "info:-") expect(result.stdout).toBe("100/50/PixelsPerCentimeter");
                        else {
                            const bytes = output === "/saved.png" ? saved : "stdoutBytes" in result && result.stdoutBytes
                                ? result.stdoutBytes : new Uint8Array(Buffer.from(result.stdout, "latin1"));
                            expect(readImageMetadata(bytes).resolution).toEqual({ x: 10000, y: 5000, unit: "meter" });
                        }
                        if (output !== "/saved.png") expect(saved).toEqual(keep);
                    }
                }
            );
        }
    }
}

for (const mode of ["retained", "buffered", "sync"] as const) {
    it(`${mode}: compare rejects invalid density before replacing its destination`, async () => {
        const keep = new TextEncoder().encode("KEEP"), files = new Map([["/saved.png", keep]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/saved.png", keep);
        const args = ["xc:red", "xc:red", "-density", "xyz", "/saved.png"];
        const result = mode === "sync" ? runCompareCliSync(args, files)
            : await runCompareCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("invalid argument");
        expect(result.stderr).toContain("-density");
        expect(mode === "retained" ? await filesystem.readFile("/saved.png") : files.get("/saved.png")).toEqual(keep);
    });
}

for (const retained of [false, true]) {
    it(`mogrify preserves input for invalid density (retained=${retained})`, async () => {
        const input = new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n");
        const files = new Map([["/input.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.ppm", input);
        const result = await runMogrifyCli(["-density", "xyz", "/input.ppm"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("-density");
        expect(retained ? await filesystem.readFile("/input.ppm") : files.get("/input.ppm")).toEqual(input);
    });
}
