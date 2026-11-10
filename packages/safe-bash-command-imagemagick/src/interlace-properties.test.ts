import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operand: "%[option:route]", value: "Plane", planar: true },
        { operand: "%[route]", value: "pLaNe", planar: true },
        { operand: "Plane", value: "None", planar: true },
        { operand: "%[option:route]", value: "None", planar: false },
        { operand: "%[option:route]", value: "invalid", planar: false },
    ])(`${mode}: expands interlace $operand with $value`, async ({ operand, value, planar }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out.rgb", keep], ["/out.png", keep]]), fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["xc:#204080", "xc:#305090", "+append", "-set", "option:route", value,
            "-interlace", operand, "-set", "option:route", "None", "-depth", "8", "-write", "rgb:/out.rgb", "PNG24:/out.png"];
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        const raw = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
        const png = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (value === "invalid") {
            expect(result.exitCode).toBe(1);
            expect(stderr).toContain("unsupported interlace type 'invalid'");
            expect(raw).toEqual(keep);
            expect(png).toEqual(keep);
            return;
        }
        expect(result.exitCode, stderr).toBe(0);
        expect(Buffer.from(raw).toString("hex")).toBe(planar ? "203040508090" : "204080305090");
        expect(png[28]).toBe(Number(planar));
        expect(Array.from(decodeImage(png).data)).toEqual([32, 64, 128, 255, 48, 80, 144, 255]);
    });
}
