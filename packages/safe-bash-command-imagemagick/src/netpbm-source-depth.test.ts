import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI reports source depth independently of effective pixel depth.
for (const mode of ["buffered", "sync", "command"] as const) {
  for (const identify of [false, true]) {
    it.each([
      ...["P2", "P3", "P5", "P6"].flatMap(magic => ([[15, 4], [31, 5], [255, 8], [511, 9], [1023, 10], [65535, 16]] as const).map(([maxval, depth]) => {
        const channels = magic === "P3" || magic === "P6" ? 3 : 1;
        const bytes = Buffer.concat([Buffer.from(`${magic}\n1 1\n${maxval}\n`), magic === "P2" || magic === "P3"
          ? Buffer.from(Array(channels).fill(0).join(" ") + "\n") : Buffer.alloc(channels * (maxval > 255 ? 2 : 1))]);
        return { name: `${magic} MAXVAL=${maxval}`, bytes, expected: `${depth}/1/0/65535` };
      })),
      { name: "PAM grayscale alpha MAXVAL=15", bytes: Buffer.concat([Buffer.from("P7\nWIDTH 1\nHEIGHT 1\nDEPTH 2\nMAXVAL 15\nTUPLTYPE GRAYSCALE_ALPHA\nENDHDR\n"), Buffer.from([9, 3])]), expected: "4/4/39321/13107" },
      { name: "plain PBM", bytes: Buffer.from("P1\n1 1\n1\n"), expected: "1/1/0/65535" },
      { name: "binary PBM", bytes: Buffer.concat([Buffer.from("P4\n1 1\n"), Buffer.from([128])]), expected: "1/1/0/65535" }
    ])(`${mode}, identify=${identify}: reports $name source depth without changing samples`, async ({ bytes, expected }) => {
      const format = "%z/%[bit-depth]/%[fx:round(65535*p{0,0}.r)]/%[fx:round(65535*a)]";
      const args = identify ? ["identify", "-format", format, "/in.pnm"] : ["/in.pnm", "-format", format, "info:"];
      const files = new Map([["/in.pnm", bytes]]);
      if (mode !== "command") {
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
        expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
        return;
      }
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.pnm", bytes);
      let stdout = "", stderr = "";
      const argumentValues = createCommandArguments(args);
      const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
  }
}
