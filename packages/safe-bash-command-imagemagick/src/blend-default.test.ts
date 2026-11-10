import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, -depth 8 rgba:out.
for (const mode of ["command", "sync", "buffered", "retained"] as const) {
  for (const operation of ["composite", "extent"] as const) {
    it.each([
      { amount: undefined, rgba: "328089e0" },
      { amount: "100x100", rgba: "328089e0" },
      { amount: "50", rgba: "32808970" },
      { amount: "25x75", rgba: "2a806768" },
    ])(`Blend ${mode} ${operation} args=$amount matches native opacity`, async ({ amount, rgba }) => {
      const settings = ["-compose", "Blend", ...(amount === undefined ? [] : ["-define", `compose:args=${amount}`])];
      const args = [...(operation === "composite"
        ? ["xc:#20804060", "xc:#4080c080", ...settings, "-composite"]
        : ["-size", "4x3", "xc:#4080c080", "-background", "#20804060", ...settings,
          "-extent", "4x3", "+repage", "-crop", "1x1+0+0"]), "-depth", "8", "rgba:/out"];
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/out", new TextEncoder().encode("KEEP"));
      const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
      let stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
        .toEqual({ exitCode: 0, stderr: "" });
      const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
      expect(Buffer.from(output).toString("hex")).toBe(rgba);
    });
  }
}
