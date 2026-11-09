import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["20x10junk", "not-angle", "x20", "", "20junkx10", "20xNaN", "20xInfinity", "20e", "20.5.5x10"])(
        `${mode}: rejects malformed shear %j without replacing output`, async geometry => {
            const source = await sharp({ create: { width: 7, height: 5, channels: 4, background: "red" } }).png().toBuffer();
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.png", source], ["/out.png", keep]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", source);
            await fs.writeFile("/out.png", keep);
            const args = ["/in.png", "-shear", geometry, "PNG32:/out.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument for option '-shear'");
            expect(mode === "buffered" || mode === "sync" ? files.get("/out.png") : await fs.readFile("/out.png")).toEqual(keep);
        }
    );
}

it.each(["0x20", "0X20", "+0x2e1", "0.0x20.0", "0x20%"])(
    "accepts valid shear %s with an explicit zero first angle", async geometry => {
        const source = await sharp({ create: { width: 7, height: 5, channels: 4, background: "red" } }).png().toBuffer();
        const files = new Map([["/in.png", source]]);
        const result = await runConvertCli(["/in.png", "-background", "white", "-shear", geometry, "PNG32:/out.png"], files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([7, 8]);
    }
);
