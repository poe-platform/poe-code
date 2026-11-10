import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "command"] as const) {
  it.each([["20%", "0%"], ["0%", "20%"], ["20%", "20%"], ["0%", "0%"]])(
    `RemoveDups uses grouped source fuzz (${mode}): %s, %s`, async (first, second) => {
      for (const before of [false, true]) {
        for (const format of ["info", "gif"]) {
          const fs = new MemoryFileSystem();
          const files = new Map<string, Uint8Array>();
          const group = (delay: string, color: string, fuzz: string) => ["(", "-delay", delay,
            ...(before ? ["-fuzz", fuzz] : []), `xc:${color}`, ...(!before ? ["-fuzz", fuzz] : []), ")"];
          const args = ["-respect-parentheses", ...group("3", "#606060", first), ...group("5", "#707070", second),
            "-delay", "7", "xc:blue", "-layers", "RemoveDups",
            ...(format === "info" ? ["-format", "%wx%h%O:%T;"] : []), `${format}:out.${format}`];
          let stderr = "";
          const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
          });
          expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
          const bytes = mode === "sync" ? files.get(`out.${format}`)! : await fs.readFile(`/out.${format}`);
          const collapse = first === "20%" || second === "20%";
          if (format === "info") {
            expect(new TextDecoder().decode(bytes)).toBe(collapse ? "1x1+0+0:8;1x1+0+0:7;" : "1x1+0+0:3;1x1+0+0:5;1x1+0+0:7;");
          } else {
            const output = decodeImage(bytes, { animated: true });
            expect(output.delay).toEqual(collapse ? [80, 70] : [30, 50, 70]);
            expect([...output.data]).toEqual([...(collapse ? [] : [96, 96, 96, 255]), 112, 112, 112, 255, 0, 0, 255, 255]);
          }
        }
      }
    });
}
