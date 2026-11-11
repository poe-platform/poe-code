import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including the white border.
const preserved = "ffffffffffffffffffffffffffffffffffffffff326496ffdccdb9ffffffffffffffffffffffffffffffffffffffffff";
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const input of ["inline", "ppm"] as const) {
        it.each([
            { filter: "Lanczos", options: [], expected: preserved },
            { filter: "Lanczos", options: ["-define", "filter:blur=0.5"], expected: "fdfefefffffffffffffffffffffffeffffffffff1e568effdfcdb5fffffffffffdfefefffffffffffffffffffffffeff" },
            { filter: "Mitchell", options: ["-define", "filter:blur=2"], expected: preserved },
            { filter: "Point", expected: preserved },
            { filter: "Triangle", expected: preserved },
            { filter: "Mitchell", expected: "fffffffff5f8fcfffffffffffffffffff3f6f9ff406e9affd3c8b9fffdfcfbfffffffffff5f8fcffffffffffffffffff" }
        ])(`${mode}, ${input}: matches native $filter $options deskew at zero rotation`, async ({ filter, options, expected }) => {
            const ppm = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([50, 100, 150, 220, 205, 185])]);
            const files = new Map<string, Uint8Array>([["/in.ppm", ppm]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", ppm);
            const argv = [...(input === "inline" ? ["xc:#326496", "xc:#dccdb9", "+append"] : ["/in.ppm"]),
                "-filter", filter, ...(options ?? []), "-deskew", "40%", "-depth", "8", "-write", "rgba:/pixels",
                "-format", "%wx%h:%g:%[deskew:angle]", "info:/geometry"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const pixels = mode === "command" || mode === "retained" ? await filesystem.readFile("/pixels") : files.get("/pixels")!;
            const geometry = mode === "command" || mode === "retained" ? await filesystem.readFile("/geometry") : files.get("/geometry")!;
            expect(Buffer.from(pixels).toString("hex")).toBe(expected);
            expect(Buffer.from(geometry).toString()).toBe(input === "inline" ? "4x3:2x3-1-1:-0" : "4x3:4x3-1-1:-0");
        });
    }
}

it("keeps Lanczos filtering for a larger zero-angle image", () => {
    const result = runConvertCliSync(["xc:#326496", "xc:#dccdb9", "xc:#326496", "+append",
        "-filter", "Lanczos", "-deskew", "40%", "-depth", "8", "rgba:-"], new Map());
    expect(result.exitCode, result.stderr).toBe(0);
    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(
        "ffffffffe8eff6ffffffffffe8eff6ffffffffffe7edf4ff5e83a6ffb2b2aeff5e83a6ffe7edf4ffffffffffe8eff6ffffffffffe8eff6ffffffffff");
});
