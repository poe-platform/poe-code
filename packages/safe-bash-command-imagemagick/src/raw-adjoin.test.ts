import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("ff0000ff00ff00800000ff40fdfbf9bf080808ff627f9113", "hex")
]);
// ImageMagick 7.1.2-35 Q16-HDRI output, first frame then its vertical flip.
const frames = [
    ["rgb", "ff000000ff000000fffdfbf9080808627f91", "fdfbf9080808627f91ff000000ff000000ff"],
    ["rgba", "ff0000ff00ff00800000ff40fdfbf9bf080808ff627f9113", "fdfbf9bf080808ff627f9113ff0000ff00ff00800000ff40"],
    ["gray", "36b612fb087a", "fb087a36b612"]
];
for (const mode of ["command", "buffered", "sync"] as const) {
    for (const destination of ["file", "stdout", "-write", "+write", "split", "pattern"] as const) {
        it.each(frames)(`${mode} ${destination} adjoins %s frames in order`, async (coder, first, second) => {
            const files = new Map<string, Uint8Array>([["/in.pam", input], ["/out", Buffer.from("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const target = `${coder}:${destination === "stdout" ? "-" : destination === "pattern" ? "/out-%d" : "/out"}`;
            const args = ["/in.pam", "(", "/in.pam", "-flip", ")", "-depth", "8",
                ...(destination === "split" ? ["+adjoin"] : []),
                ...(destination === "-write" || destination === "+write" ? [destination, target, "null:"] : [target])];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const read = async (path: string) => Buffer.from(mode === "command" ? await fs.readFile(path) : files.get(path)!).toString("hex");
            if (destination === "split" || destination === "pattern") {
                expect(await read("/out")).toBe("4b454550");
                expect(await read("/out-0")).toBe(first);
                expect(await read("/out-1")).toBe(second);
            } else if (destination === "stdout") {
                expect(Buffer.from(mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()).toString("hex")).toBe(first! + second!);
            } else expect(await read("/out")).toBe(first! + second!);
        });
    }
}

it.each([false, true])("joins differently sized opaque frames at 16-bit depth, retained=%s", async retained => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const result = await runMagickCli(["-size", "1x1", "xc:red", "-size", "2x1", "xc:blue", "-depth", "16", "-endian", "MSB", "rgba:/out"], retained ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(Buffer.from(retained ? await filesystem.readFile("/out") : files.get("/out")!).toString("hex")).toBe("ffff00000000ffff" + "00000000ffffffff".repeat(2));
});
