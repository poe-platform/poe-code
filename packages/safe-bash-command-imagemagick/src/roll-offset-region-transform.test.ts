import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Full RGB8 rasters from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(Array.from({ length: 45 }, (_, i) => i * 5))]);
const cases: { operations: string[]; rgb: string; region?: string }[] = [
    { operations: ["-roll", "+0+0", "-flop", "+region"], rgb: "3c41462d32371e23282d32373c41464b50555a5f64696e73787d82878c91969ba0a5aaafb4b9bec3c8cdd2d7dc" },
    { operations: ["-roll", "+1+1", "-flop", "+region"], rgb: "3c41462d32371e23282d32373c41464b50555a5f64696e73787d82878c91969ba0a5aaafb4b9bec3c8cdd2d7dc" },
    { operations: ["-roll", "+0+0", "-flip", "+region"], rgb: "969ba0a5aaaf1e23282d32373c41464b50555a5f64696e73787d82878c91969ba0a5aaafb4b9bec3c8cdd2d7dc" },
    { operations: ["-roll", "+0+0", "-rotate", "90", "+region"], rgb: "969ba04b50551e23282d32373c41464b50555a5f64696e73787d82878c91969ba0a5aaafb4b9bec3c8cdd2d7dc" },
    { operations: ["-roll", "+0+0", "+region"], rgb: "00050a0f14191e23282d32373c41464b50555a5f64696e73787d82878c91969ba0a5aaafb4b9bec3c8cdd2d7dc" },
    { operations: ["-flop", "+region"], rgb: "3c41462d32371e23280f141900050a878c91787d82696e735a5f644b5055d2d7dcc3c8cdb4b9bea5aaaf969ba0" },
    { operations: ["-roll", "+0+0", "-flop", "+region"], rgb: "3c41460f14191e23282d32373c41464b50555a5f64696e73787d82878c91969ba0a5aaafb4b9bec3c8cdd2d7dc", region: "1x1+0+0" },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`preserves the region after roll in ${mode}: $operations`, async ({ operations, rgb, region = "1x1+1+0" }) => {
        const files = new Map<string, Uint8Array>([["/input.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.ppm", input);
        const args = ["/input.ppm", "-region", region, ...operations, "-depth", "8", "rgb:/output.rgb"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "buffered" || mode === "sync" ? files.get("/output.rgb")! : await fs.readFile("/output.rgb");
        expect(Buffer.from(output).toString("hex")).toBe(rgb);
    });
}
