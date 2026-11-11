import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const rgba = Buffer.concat([
    Buffer.from("P7\nWIDTH 2\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("012345176789ab88cdefffe112345600", "hex"),
]);
const rgb = Buffer.concat([
    Buffer.from("P6\n2 2\n255\n"),
    Buffer.from("0123456789abcdefff123456", "hex"),
]);

// ImageMagick 7.1.2-35 Q16-HDRI: BGRA keeps BGR order at 12 bits, but not 10.
const cases = [
    ...["bgr", "bgro"].flatMap(coder => [
        { coder, depth: 10, hex: "0108c4559d89aae0cdbbfffc48345590" },
        { coder, depth: 12, hex: "010232454676898abacdcefefff121343565" },
    ]),
    { coder: "bgra", depth: 10, hex: "0108c4545c67626aba22cdbbffff87120d156400" },
    { coder: "bgra", depth: 12, hex: "454232010171aba898676888fffefecdce1d565343121000" },
    { coder: "bgr", depth: 16, hex: "454523230101abab89896767ffffefefcdcd565634341212" },
];

for (const mode of ["command", "sync"] as const) {
    for (const destination of ["file", "stdout"] as const) {
        it.each(cases)(`${mode} ${destination}: writes packed $coder at depth $depth`, async ({ coder, depth, hex }) => {
            const input = coder === "bgro" ? rgb : rgba;
            const files = new Map<string, Uint8Array>([["/in.bin", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.bin", input);
            const args = ["/in.bin", "-depth", String(depth), "-endian", "MSB", `${coder}:${destination === "stdout" ? "-" : "/out"}`];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = destination === "stdout"
                ? mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()
                : mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(hex);
        });
    }
}
