import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: -size 2x1 xc:#3070b080 -background '#206030'
// -define png:exclude-chunks=date,time PNG32:-
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAAgAGAAMFaMb/cAAAARSURBVAjXYzQo2NDAwMDAAAALQgHSAEgS7wAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const operation of [["-flatten"], ["-layers", "flatten"], ["-layers", "merge"], ["-mosaic"], ["-layers", "mosaic"]]) {
        it.each([undefined, "#206030", "white"])(`${mode} ${operation.join(" ")} uses stored background with override %s`, async background => {
            const files = new Map<string, Uint8Array>([["/in.png", input], ["/out", Buffer.from("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(name, bytes);
            const args = ["/in.png", ...(background ? ["-background", background] : []), ...operation, "-depth", "8", "rgba:/out"];
            const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
                args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} } })
                : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(background === "white" ? "97b7d7ff97b7d7ff" : "286870ff286870ff");
        });
    }
}
