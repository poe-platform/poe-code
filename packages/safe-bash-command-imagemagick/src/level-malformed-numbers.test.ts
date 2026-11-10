import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "command"] as const) {
    // Native ImageMagick 7.1.2-35 Q16-HDRI status and raw destination bytes.
    it.each([
        { operator: "-level", geometry: "10e,80%" },
        { operator: "+level", geometry: "1e+" },
        { operator: "-level", geometry: "1.2.3%" },
        { operator: "+level", geometry: "+1+2" },
        { operator: "+level", geometry: "bogus" },
        { operator: "-level", geometry: "10x80%", expected: "00004e29ab620000b56cfffff317ffff38a6" },
        { operator: "-level", geometry: "1e1,8e1%", expected: "00004e29ab620000b56cfffff317ffff38a6" },
        { operator: "-level", geometry: "10,80%,1e+", expected: "00004e29ab620000b56cfffff317ffff38a6" },
        { operator: "+level", geometry: "10,80e%", expected: "242451d27f7f258c846abbeea2a2abc54747" },
    ])(`validates $operator $geometry before writing via ${mode}`, async ({ operator, geometry, expected }) => {
        const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/a.ppm", input], ["/out", original]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/a.ppm", operator, geometry, "-endian", "MSB", "-depth", "16", "rgb:/out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
        expect.soft(result.exitCode).toBe(expected ? 0 : 1);
        const output = mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected ?? "4b454550");
    });
}
