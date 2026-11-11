import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["10x20", "10,20", "10/20", "(10x20)", "(10,20)", "(10/20)"])(`matches native local-contrast geometry %s (${mode})`, async geometry => {
        const input = Uint8Array.from([...new TextEncoder().encode("P6\n7 5\n255\n"), ...Array.from({ length: 105 }, (_, i) => (i * 41 + 51) % 256)]);
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-local-contrast", geometry, "-depth", "8", "rgb:/out"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        // Complete RGB8 raster from ImageMagick 7.1.2 Q16-HDRI.
        expect(createHash("sha256").update(output).digest("hex")).toBe("9b9e99b2e94c14fbc838a0cfdc793f71fd73aa214f40a3803d6da74aa000ebe9");
    });
}
