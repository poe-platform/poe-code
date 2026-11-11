import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -size 6x4 xc:red -background black -shear GEOMETRY -depth 8 rgb:-.
for (const mode of ["command", "buffered", "retained", "sync", "mogrify"] as const) {
    it.each([
        { geometries: ["%wx15", "%[fx:w]x15", "6x15"], height: 5, hash: "9c9ce1bcc798d3a339dc7e2abe46cbf4c3c6c6dfbd3a706dafdab1fcbd920cc5" },
        { geometries: ["%hx15", "%[fx:h]x15", "4x15"], height: 6, hash: "ac14311889ff743060ff216f8bd8289b7ab1614fc4302e44e8a78f402b6d04a7" }
    ])(`expands short shear properties to native RGB pixels (${mode}, height=$height)`, async ({ geometries, height, hash }) => {
        for (const geometry of geometries) {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const options = ["-background", "black", "-shear", geometry];
            let args = ["-size", "6x4", "xc:red", ...options, "PNG24:/out.png"];
            if (mode === "mogrify") {
                const input = Buffer.concat([Buffer.from("P6\n6 4\n255\n"), Uint8Array.from({ length: 72 }, (_, i) => i % 3 === 0 ? 255 : 0)]);
                await filesystem.writeFile("/in.ppm", input);
                args = [...options, "/in.ppm"];
            }
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await (mode === "mogrify" ? runMogrifyCli : runConvertCli)(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, `${geometry}: ${"stderr" in result ? result.stderr : stderr}`).toBe(0);
            const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await filesystem.readFile(mode === "mogrify" ? "/in.ppm" : "/out.png"));
            expect([output.width, output.height]).toEqual([6, height]);
            const rgb = output.data.filter((_, index) => index % 4 !== 3);
            expect(createHash("sha256").update(rgb).digest("hex"), geometry).toBe(hash);
        }
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`expands short shear properties using each image's current dimensions (${mode})`, async () => {
        const outputs = [];
        for (const short of [false, true]) {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["-size", "6x4", "xc:red", "(", "-size", "9x7", "xc:blue", ")", "-background", "black",
                "-shear", short ? "%wx15" : "%[fx:w]x15", "-shear", short ? "10x%h" : "10x%[fx:h]", "+append", "PNG24:/out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            outputs.push({ width: output.width, height: output.height, data: output.data });
        }
        expect(outputs[1]).toEqual(outputs[0]);
    });
}
