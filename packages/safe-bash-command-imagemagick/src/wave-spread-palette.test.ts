import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n4 3\n255\n"),
    Buffer.from(Array.from({ length: 36 }, (_, i) => (37 * i + 11) % 256))
]);
// ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1, raw 8-bit RGBA.
const cases = [
    {
        operation: ["-wave", "1x4"],
        pixels: "ffffffffffffffffffffffff587da2ff0b3055ffffffffffe90e33ff14395effc7ec11ff7a9fc4ffa5caefffd0f51aff83a8cdff365b80ff6186abfffffffffffffffffff2173cffffffffffffffffff",
        cycled: "0b3055ff0b3055ff0b3055ff6186abff14395eff0b3055fff2173cffe90e33ffd0f51aff83a8cdffffffffff365b80ffa5caefff587da2ff7a9fc4ff0b3055ff0b3055ffc7ec11ff0b3055ff0b3055ff"
    },
    {
        operation: ["-seed", "17", "-spread", "2"],
        pixels: "878e58ff795d82ffd0f51aff587da2ff0b3055ffb7dc37ffcd3358ff587da2ff8bb027ffb03a5fffbc496eff698ea0ff",
        cycled: "795d82ff587da2ff878e58ff698ea0ffb03a5fffd0f51affbc496eff698ea0ffb7dc37ffcd3358ff8bb027ff0b3055ff"
    }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const type of ["Palette", "TrueColor"]) {
        for (const output of ["info", "pixels", "cycled"] as const) {
            it.each(cases)(`${mode}: ${type} $operation ${output}`, async ({ operation, pixels, cycled }) => {
                const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in.ppm", input);
                const argv = ["/in.ppm", "-type", type, ...operation,
                    ...(output === "cycled" ? ["-cycle", "1"] : []),
                    ...(output === "info" ? ["-format", "%r|%[channels]", "info:/out"] : ["-depth", "8", "rgba:/out"])];
                const argumentValues = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
                expect(result.exitCode, stderr).toBe(0);
                expect(stderr).toBe("");
                const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
                expect(output === "info" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex"))
                    .toBe(output === "info" ? "DirectClass sRGB |srgb  3.0" : output === "pixels" ? pixels : cycled);
            });
        }
    }
}
