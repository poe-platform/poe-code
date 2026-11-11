import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI:
// magick 'xc:#3685c3' -depth 16 txt:in.txt
const native = "# ImageMagick pixel enumeration: 1,1,0,65535,srgb\n0,0: (13878,34181,50115)  #36368585C3C3  srgb(54,133,195)\n";
const format = "%[fx:round(p{0,0}.r*65535)]/%[fx:round(p{0,0}.g*65535)]/%[fx:round(p{0,0}.b*65535)]";

for (const mode of ["command", "buffered", "sync"] as const) {
  it.each([
    { name: "native numeric annotation", text: native, expected: "54/133/195" },
    { name: "removed annotation", text: native.replace("srgb(54,133,195)", ""), expected: "13878/34181/50115" },
    { name: "percentage annotation", text: native.replace("54,133,195", "50%,25%,100%"), expected: "32767/16383/65535" },
    { name: "last annotation", text: native.trimEnd() + " srgb(4,5,6)\n", expected: "4/5/6" },
    { name: "alpha annotation", text: "# ImageMagick pixel enumeration: 1,1,0,65535,srgba\n0,0: (13878,34181,50115,32896)  #36368585C3C38080  srgba(54,133,195,0.501961)\n", expected: "13878/34181/50115" }
  ])(`reads $name through ${mode}`, async ({ text, expected }) => {
    const bytes = new TextEncoder().encode(text);
    const argv = ["in.txt", "-format", format, "info:"];
    if (mode !== "command") {
      const files = new Map([["in.txt", bytes]]);
      const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
      expect(result).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
      return;
    }
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.txt", bytes);
    const command = createMagickCommand(), args = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = await command.execute({
      command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect({ exitCode: result.exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
}
