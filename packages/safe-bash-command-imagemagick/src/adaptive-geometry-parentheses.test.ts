import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// RGB bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const [option, expected] of [["-adaptive-sharpen", "40607098a286"], ["-adaptive-blur", "40607077897e"]]) {
    for (const mode of ["command", "buffered", "retained", "sync"] as const) {
        it.each(["2x3", "(2x3)", "(%[option:geometry])"])(`${option} accepts %s (${mode})`, async geometry => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const argv = ["xc:#406070", "xc:#809080", "+append", "-set", "option:geometry", "2x3", option!, geometry, "-depth", "8", "rgb:/out"];
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
