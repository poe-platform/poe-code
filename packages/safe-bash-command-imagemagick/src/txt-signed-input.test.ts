import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, identical input and -depth 8 raw output.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
  it.each([
    { space: "srgb", tuple: "1,+2,3", output: "rgb", hex: "010300" },
    { space: "srgb", tuple: "1,-2,3", output: "rgb", hex: "010300" },
    { space: "srgb", tuple: "-1,2,3", output: "rgb", hex: "020300" },
    { space: "srgb", tuple: "1,2,3", output: "rgb", hex: "010203" },
    { space: "srgba", tuple: "1,-2,3,4", output: "rgba", hex: "01030400" },
    { space: "srgba", tuple: "1,2,3,-4", output: "rgba", hex: "01020300" },
    { space: "gray", tuple: "-1", output: "rgba", hex: "000000ff" },
    { space: "graya", tuple: "-1,2", output: "rgba", hex: "02020200" },
    { space: "cmyk", tuple: "1,-2,3,4", output: "cmyk", hex: "01030400" },
  ])(`reads signed $space TXT ($tuple) via ${mode}`, async ({ space, tuple, output, hex }) => {
    const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,0,255,${space}\n0,0: (${tuple})\n`);
    const files = new Map([["/in.txt", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.txt", bytes);
    const args = ["/in.txt", "-depth", "8", `${output}:/out.raw`];
    if (mode === "command") {
      let errors = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(chunk) { errors += new TextDecoder().decode(chunk); } },
      });
      expect({ ...result, stderr: errors }).toEqual({ exitCode: 0, stderr: "" });
    } else {
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "" });
    }
    const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") as Uint8Array : files.get("/out.raw")!;
    expect(Buffer.from(pixels).toString("hex")).toBe(hex);
  });
}
