import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "map", "filesystem", "fallback", "command"] as const) {
  for (const identify of [true, false]) {
    it.each([
      { inputs: ["*.ppm"], output: "1x1;2x1;3x1;" },
      { inputs: ["[ab].ppm"], output: "1x1;2x1;" },
      { inputs: ["[a-b].ppm"], output: "1x1;2x1;" },
      { inputs: ["?.ppm"], output: "1x1;2x1;" },
      { inputs: ["b.ppm", "[as]*.ppm", "a.ppm"], output: "2x1;1x1;3x1;1x1;" },
      { inputs: ["a.ppm[0]"], output: "1x1;" },
      { inputs: ["[ab].ppm[0]"], output: "1x1;2x1;" },
      { inputs: ["missing*.ppm"], output: "", missing: true },
      { inputs: ["a.ppm"], format: "*.ppm", output: "*.ppm" },
      { inputs: ["/images/?.ppm"], output: "1x1;2x1;" }
    ])(`expands image input globs (${mode}, identify=${identify}): $inputs`, async ({ inputs, output, missing, format }) => {
      // Deliberately insert out of order; spaces remain part of one filename.
      const files = new Map([
        ["sp ace.ppm", new TextEncoder().encode("P3\n3 1\n255\n0 0 255 0 0 255 0 0 255\n")],
        ["b.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 255 0 0 255 0\n")],
        ["a.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
        ["a.ppm0", new TextEncoder().encode("P3\n2 1\n255\n0 255 0 0 255 0\n")],
        [".hidden.ppm", new TextEncoder().encode("P3\n4 1\n255\n" + "0 0 0 ".repeat(4))]
      ]);
      const fs = new MemoryFileSystem();
      await fs.mkdir("/images");
      for (const [path, bytes] of files) await fs.writeFile(`/images/${path}`, bytes);
      await fs.mkdir("/images/directory.ppm");
      if (inputs[0]!.startsWith("/")) {
        for (const [path, bytes] of [...files]) { files.delete(path); files.set(`/images/${path}`, bytes); }
      }
      const args = [...(identify ? ["identify"] : []), "-format", format ?? "%wx%h;", ...inputs, ...(identify ? [] : ["info:"])];
      let result;
      if (mode === "sync") result = runMagickCliSync(args, files);
      else if (mode === "map") result = await runMagickCli(args, files);
      else if (mode !== "command") {
        if (mode === "fallback") Object.defineProperty(fs, "removeFileConditional", { value: undefined });
        result = await runMagickCli(args, { filesystem: fs, cwd: "/images" });
      } else {
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const status = await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/images", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { ...status, stdout, stderr };
      }
      expect(result.exitCode, result.stderr).toBe(missing ? 1 : 0);
      expect(result.stdout).toBe(output);
      if (missing) expect(result.stderr).toContain("missing*.ppm");
      else expect(result.stderr).toBe("");
    });
  }
}

for (const mode of ["sync", "map", "filesystem", "fallback"] as const) {
  it(`keeps wildcard option values and output filenames literal (${mode})`, async () => {
    const files = new Map([
      ["a.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
      ["b.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 255 0 0 255 0\n")],
      ["reportA.txt", new TextEncoder().encode("unchanged")]
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
    if (mode === "fallback") Object.defineProperty(filesystem, "removeFileConditional", { value: undefined });
    const args = ["(", "[ab].ppm", ")", "-set", "comment", "*.ppm", "-format", "%c:%w;", "info:report*.txt"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    const read = async (path: string) => mode === "map" || mode === "sync" ? files.get(path)! : filesystem.readFile(`/${path}`);
    expect(new TextDecoder().decode(await read("report*.txt"))).toBe("*.ppm:1;*.ppm:2;");
    expect(new TextDecoder().decode(await read("reportA.txt"))).toBe("unchanged");
    for (const path of ["a.ppm", "b.ppm"]) expect(await read(path)).toEqual(await filesystem.readFile(`/${path}`));
  });
}
