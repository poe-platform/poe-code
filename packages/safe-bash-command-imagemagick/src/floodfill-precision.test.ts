import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// The first two pixels differ by one 16-bit red quantum, but share an 8-bit preview.
const inputs = {
    high: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABEAYAAACprNOOAAAAHUlEQVR4nGNwcPDwSEj4/9/BEUL//88ABEA+VBwA75UPaB4Aq34AAAAASUVORK5CYII=",
    low: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAE0lEQVR4nGNw8Ej4D8L/GRjANAA91Qe0ftVsfAAAAABJRU5ErkJggg=="
};
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const depth of ["high", "low"] as const) {
      for (const outputFormat of ["PNG32", "PNG64"]) {
        it.each([
            { args: ["-fill", "lime", "-floodfill", "+0+0", "#404860"], selected: 0, alphaOnly: false },
            { args: ["-fill", "lime", "-floodfill", "+1+0", depth === "high" ? "#404148486060" : "#404860"], selected: 1, alphaOnly: false },
            { args: ["-fill", "none", "-draw", "alpha 0,0 floodfill"], selected: 0, alphaOnly: true },
            { args: ["-fill", "lime", "-draw", "color 0,0 floodfill"], selected: 0, alphaOnly: false }
        ])(`matches input precision (${mode}, ${depth}, ${outputFormat}, $args)`, async ({ args, selected, alphaOnly }) => {
            const bytes = Uint8Array.from(Buffer.from(inputs[depth], "base64"));
            const files = new Map([["in.png", bytes]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", bytes);
            const argv = ["in.png", ...args, `${outputFormat}:out.png`];
            const commandArgs = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: commandArgs.args, argumentValues: commandArgs, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, stderr).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
            const expected = decodeImage(bytes).data.slice();
            for (const pixel of depth === "high" ? [selected] : [0, 1]) {
                if (alphaOnly) expected[pixel * 4 + 3] = 0;
                else expected.set([0, 255, 0, 255], pixel * 4);
            }
            expect(output.data).toEqual(expected);
            if (outputFormat === "PNG64" && depth === "high") {
                const expected16 = decodeImage(bytes).data16!.slice();
                if (alphaOnly) expected16[selected * 4 + 3] = 0;
                else expected16.set([0, 65535, 0, 65535], selected * 4);
                expect(output.data16).toEqual(expected16);
            }
        });
      }
    }
}
