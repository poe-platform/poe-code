import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n7 5\n255\n"),
    Buffer.from(Array.from({ length: 105 }, (_, i) => (13 * i + 9) % 256)),
]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["2x16", "2x0x10"])(`${mode}: reads wave wavelength %s`, async geometry => {
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-wave", geometry, "-depth", "8", "rgb:/out.raw"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
        expect(output).toHaveLength(189);
        // Native ImageMagick 7.1.2-35 Q16-HDRI raw 8-bit RGB output.
        expect(createHash("sha256").update(output).digest("hex"))
            .toBe("f5d431222b0beff1209341c46a97b9dec746bea7dac1972e4de7588cb5dd9062");
    });
}
