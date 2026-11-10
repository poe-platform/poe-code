import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// RGB8 output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "map", "retained", "command"] as const) {
  it.each([
    { property: "option:op", value: "Sum", operator: "%[op]", valid: true },
    { property: "option:op", value: "Sum", operator: "%[option:op]", valid: true },
    { property: "op", value: "Sum", operator: "%[op]", valid: true },
    { property: "option:op", value: "Sum", operator: "Sum", valid: true },
    { property: "option:op", value: "Sum", operator: "bogus", valid: false },
    { property: "option:op", value: "bogus", operator: "%[op]", valid: false },
  ])(`${mode}: evaluates $operator with $property=$value`, async ({ property, value, operator, valid }) => {
    const encoder = new TextEncoder();
    const previous = encoder.encode("KEEP");
    const files = new Map([
      ["/a.ppm", encoder.encode("P3\n2 1\n255\n13 30 79 235 153 61\n")],
      ["/c.ppm", encoder.encode("P3\n2 1\n255\n52 73 91 114 137 180\n")],
      ["/out", previous],
    ]);
    const fs = createMemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/a.ppm", "/c.ppm", "-set", property, value,
      "-evaluate-sequence", operator, "-depth", "8", "rgb:/out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result, JSON.stringify(result)).toMatchObject({ exitCode: valid ? 0 : 1 });
    const output = mode === "sync" || mode === "map" ? files.get("/out")! : await fs.readFile("/out");
    expect(output).toEqual(valid ? Uint8Array.from([65, 103, 170, 255, 255, 241]) : previous);
    if (!valid) expect("stderr" in result ? result.stderr : stderr).toContain("unrecognized evaluate operator");
  });
}
