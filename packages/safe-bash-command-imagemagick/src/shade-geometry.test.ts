import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new Uint8Array(Buffer.concat([
    Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ff40a0209020a0101220", "hex"),
]));
const keep = new TextEncoder().encode("KEEP");

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGB8 output for the same PPM input.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ...["30x45", "30,45", "30/45", "(30x45)", "30x45+1+1", "30x45!", "3e1x4.5e1"]
            .map(geometry => [geometry, "787878d7d7d7d9d9d9bbbbbbe0e0e0d0d0d0"]),
        ...["30:45", "0.6666666667x1"].map(geometry => [geometry, "0000005a5a5a979797060606777777747474"]),
        ["-30x45", "6c6c6ce5e5e5fafafaaeaeaeedededf5f5f5"],
        ["30x-45", "000000000000000000000000000000000000"],
        ...["30", "x45", "30x", "30x45+bad"].map(geometry => [geometry, ""]),
    ])(`matches native shade geometry %s (${mode})`, async (geometry, expected) => {
        const files = new Map([["/in.ppm", input], ["/out", keep]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        await fs.writeFile("/out", keep);
        const args = ["/in.ppm", "-shade", geometry!, "-depth", "8", "rgb:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const diagnostic = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        const output = mode === "sync" || mode === "buffered" ? files.get("/out")! : await fs.readFile("/out");
        expect(result.exitCode, diagnostic).toBe(expected ? 0 : 1);
        if (expected) {
            expect(diagnostic).toBe("");
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        } else {
            expect(diagnostic).toContain("invalid argument for option '-shade'");
            expect(diagnostic).toContain(geometry);
            expect(diagnostic).toContain("at CLI arg 2");
            expect(output).toEqual(keep);
        }
    });
}
