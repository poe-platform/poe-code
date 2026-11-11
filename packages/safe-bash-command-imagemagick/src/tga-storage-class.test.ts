import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Independent indexed TGA: two BGR palette entries, then their indices.
// ImageMagick 7.1.2-35 reports PseudoClass and retains the map on default rewrite.
for (const mode of ["sync", "map", "filesystem", "command"]) for (const rle of [false, true]) {
  for (const info of [false, true]) {
    it(`preserves indexed TGA storage class (${mode}, rle=${rle}, info=${info})`, async () => {
      const header = Buffer.from("000101000002001800000000020001000800", "hex");
      header[2] = rle ? 9 : 1;
      const input = Buffer.concat([header, Buffer.from("1e140a826e5a", "hex"), Buffer.from(rle ? [1, 0, 1] : [0, 1])]);
      const files = new Map([["/in.tga", new Uint8Array(input)]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.tga", input);
      const args = ["/in.tga", ...(info ? ["-format", "%r", "info:-"] : ["/out.tga"])];
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout.push(chunk); } }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
      expect(result.exitCode).toBe(0);
      expect("stderr" in result ? result.stderr : stderr).toBe("");
      if (info) expect("stdout" in result ? result.stdout : Buffer.concat(stdout).toString()).toBe("PseudoClass sRGB ");
      else {
        const output = mode === "filesystem" || mode === "command" ? await filesystem.readFile("/out.tga") : files.get("/out.tga")!;
        expect([...output.subarray(0, 3)]).toEqual([0, 1, rle ? 9 : 1]);
        expect([...output.subarray(5, 8)]).toEqual([2, 0, 24]);
        expect(Buffer.from(output.subarray(18)).toString("hex")).toBe(rle ? "1e140a826e5a010001" : "1e140a826e5a0001");
        expect([...decodeImage(output).data]).toEqual([10, 20, 30, 255, 90, 110, 130, 255]);
      }
    });
  }
}
