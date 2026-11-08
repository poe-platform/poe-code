import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native: magick 'xc:#20408070' 'xc:#90a0b0c0' +append -strip PNG32:-
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12NUcGgoKEgwCAAAC5ICopdym6wAAAAASUVORK5CYII=", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    ["channel(0.1,0.5,0.9)", "RGB", [26, 128, 230, 112, 26, 128, 230, 192]],
    ["channel(0.2,0.4,0.6,0.8)", "RGB", [51, 102, 153, 112, 51, 102, 153, 192]],
    ["channel(0.1,0.5,0.9,0.3,0.7)", "RGBA", [26, 128, 230, 179, 26, 128, 230, 179]],
    ["channel(0.1,0.5,0.9,0.3)", "RGBA", [26, 128, 230, 0, 26, 128, 230, 0]],
    ["channel(0.1)", "RGB", [26, 0, 0, 112, 26, 0, 0, 192]],
    ["channel(0.1,0.5)", "G", [32, 128, 128, 112, 144, 128, 176, 192]],
    ["channel(r,g,b,0,a)", "RGBA", [32, 64, 128, 112, 144, 160, 176, 192]],
    ["u", "RGB", [32, 64, 128, 112, 144, 160, 176, 192]],
  ] as const)(`${mode}: selects FX %s components with %s`, async (expression, channels, expected) => {
    const files = new Map([["input.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["input.png", "-channel", channels, "-fx", expression, "+channel", "out.png"];
    const argumentValues = createCommandArguments(args);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
      signal: new AbortController().signal, registerCleanup() {},
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
    expect(Array.from(decodeImage(output).data)).toEqual(expected);
  });
}
