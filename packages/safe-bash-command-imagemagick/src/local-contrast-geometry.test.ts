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

// ImageMagick 7.1.2-35 Q16-HDRI: complete RGB8 output for the same two pixels.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ...["250x50", "250X50", "250x50!", "250x50%", "250x50<", "250x50>", "250x50^", "250x50@", "250x50#",
            "250x50+0+0", "250x50+2-3", "250x50xx", "250,50,3", "250/50/3", "(250 X 50!)", "-250x50"]
            .map(geometry => ({ geometry, hex: "0d1a2887a4c2" })),
        ...["x", "+2+3", "0b10x50", "0o10x50", "10x12.5", "x-50", "", "bogus", "12x50junk", "12xInfinity"]
            .map(geometry => ({ geometry, hex: "0b1722657c92" })),
        ...["250:50", "5x1", "250:50:1"].map(geometry => ({ geometry, hex: "0a141e5b6f83" })),
        ...["250x", "250x+50"].map(geometry => ({ geometry, hex: "0b1620657c92" })),
        ...["x50", "12x50x3"].map(geometry => ({ geometry, hex: "0f1e2d87a5c3" })),
        { geometry: "250x-50", hex: "070e142d3842" },
        { geometry: "250:50:0", hex: "0a141f5c7085" },
        { geometry: "250x0x10", hex: "0b1621687f97" },
    ])(`matches native local-contrast fields $geometry (${mode})`, async ({ geometry, hex }) => {
        const input = Uint8Array.from([...new TextEncoder().encode("P6\n2 1\n255\n"), ...Buffer.from("0a141e5a6e82", "hex")]);
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-local-contrast", geometry, "-depth", "8", "rgb:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
