import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "magick", "montage"] as const) {
  for (const source of ["generated", "files"] as const) {
    for (const target of ["info:-", "info:/pages.txt"]) {
      it.each([
        { count: 1, tile: "1x1", expected: "0/1/1;" },
        { count: 2, tile: "1x1", expected: "0/2/2;1/2/2;" },
        { count: 3, tile: "2x1", expected: "0/2/2;1/2/2;" },
        { count: 2, tile: "2x1", expected: "0/1/1;" }
      ])(`${mode} counts montage pages from ${source} to ${target}: $count tiles in $tile`, async ({ count, tile, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const colors = ["255 0 0", "0 0 255", "0 255 0"];
        const inputs = source === "generated" ? ["xc:red", "xc:blue", "xc:lime"].slice(0, count)
          : colors.slice(0, count).map((_, index) => `/tile${index}.ppm`);
        if (source === "files") for (const [index, path] of inputs.entries()) {
          const bytes = new TextEncoder().encode(`P3\n1 1\n255\n${colors[index]}\n`);
          files.set(path, bytes);
          await fs.writeFile(path, bytes);
        }
        const args = ["-geometry", "+0+0", "-tile", "1x1", "-tile", tile,
          ...inputs, "-format", "%s/%n/%[fx:n];", target];
        let result;
        if (mode === "magick" || mode === "montage") {
          let stdout = "", stderr = "";
          const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
          const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
          const status = await command.execute({
            command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
          });
          result = { ...status, stdout, stderr };
        } else result = mode === "sync" ? runMontageCliSync(args, files)
          : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const fileOutput = target === "info:/pages.txt";
        expect(result).toEqual({ exitCode: 0, stdout: fileOutput ? "" : expected, stderr: "" });
        if (fileOutput) expect(new TextDecoder().decode(mode === "buffered" || mode === "sync"
          ? files.get("/pages.txt") : await fs.readFile("/pages.txt"))).toBe(expected);
        const paths = mode === "buffered" || mode === "sync" ? [...files.keys()]
          : (await fs.readdir("/")).map(entry => `/${entry.name}`);
        expect(paths.sort()).toEqual([...(source === "files" ? inputs : []), ...(fileOutput ? ["/pages.txt"] : [])].sort());
      });
    }
  }
}
