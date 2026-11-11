import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(["None", "none", "Transparent"])(`matches native transparent splice pixels with %s (${mode})`, async method => {
        const input = Uint8Array.from([...new TextEncoder().encode("P6\n4 3\n255\n"),
            ...Array.from({ length: 36 }, (_, i) => (13 * i + 9) % 256)]);
        const files = new Map([["/in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", "-seed", "123", "-background", "#cc1177", "-virtual-pixel", method,
            "-splice", "2x2-2-2", "-depth", "8", "-write", "rgba:/out",
            "-format", "%wx%h|%[virtual-pixel]|%[option:virtual-pixel]", "info:/info"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const retained = mode === "retained" || mode === "command";
        const output = retained ? await filesystem.readFile("/out") : files.get("/out")!;
        const info = retained ? await filesystem.readFile("/info") : files.get("/info")!;
        expect(new TextDecoder().decode(info)).toBe(`6x5|${method}|${method}`);
        expect(output).toHaveLength(120);
        expect(Array.from(output.subarray(0, 4))).toEqual([0, 0, 0, 0]);
        expect(Array.from(output.subarray(16, 20))).toEqual([0, 0, 0, 0]);
        // Native ImageMagick 7.1.2-35 Q16-HDRI, including the Transparent control.
        expect(createHash("sha256").update(output).digest("hex"))
            .toBe("1bbcb2ccfff01bb6394970a293c69675549c5070cc19e14c15c68b52c31164a2");
    });
}
