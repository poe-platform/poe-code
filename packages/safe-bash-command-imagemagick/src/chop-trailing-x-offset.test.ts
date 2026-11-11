import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a 6x5 PPM with samples 0 through 89.
const cases = [
    ...[
        { geometries: ["-1x1", "4x3-1+0"], metadata: "2x2|1x1+0+0", pixels: "0c0d0e0f1011545556575859" },
        { geometries: ["+1x1", "4x3+1+0"], metadata: "2x2|1x1+0+0", pixels: "00010203040548494a4b4c4d" },
        { geometries: ["1x1"], metadata: "5x4|3x2+1+1", pixels: "000102030405090a0b0c0d0e0f10111213141516171b1c1d1e1f20212223363738393a3b3f404142434445464748494a4b4c4d515253545556575859" },
    ].flatMap(({ geometries, metadata, pixels }) => geometries.flatMap(geometry => [
        { geometry, output: "info", expected: metadata },
        { geometry, output: "rgb", expected: pixels },
    ])),
    { geometry: "1x1+1x2", output: "info", expected: "5x4|3x2+1+1" },
    { geometry: "1x1+1+0", output: "info", expected: "5x4|3x2+1+1" },
    ...["1x1+1x2", "1x1+1+0"].map(geometry => ({
        geometry, output: "rgb",
        expected: "0001020304050607080c0d0e0f101112131415161718191a1e1f20212223363738393a3b3c3d3e42434445464748494a4b4c4d4e4f50545556575859",
    })),
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`preserves the chop rectangle for $geometry ($output, ${mode})`, async ({ geometry, output, expected }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...Array.from({ length: 90 }, (_, i) => i)]);
        const files = new Map([["/in.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = ["/in.ppm", "-repage", "4x3+1+1", "-gravity", "Center", "-chop", geometry, ...(output === "info" ? ["-format", "%wx%h|%g"] : ["-depth", "8"]), `${output}:/out`];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex")).toBe(expected);
    });
}
