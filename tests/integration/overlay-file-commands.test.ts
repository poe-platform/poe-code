import { expect, test } from "vitest";
import { MemoryFileSystem, OverlayFileSystem } from "@poe-code/safe-fs/core";
import { Shell } from "../../packages/safe-bash/src/shell/shell.js";
import { standardCommands } from "../../packages/safe-bash/src/commands/index.js";
import { byteCommands } from "../../packages/safe-bash/src/commands/bytes/index.js";
import { textProgramCommands } from "../../packages/safe-bash/src/commands/text-programs/index.js";
import { ssconvertCommands } from "safe-bash-command-ssconvert";
const bytes = (value: string) => new TextEncoder().encode(value);

for (const layer of ["upper", "lower"] as const) {
  for (const [command, extension] of [["gzip", "gz"], ["bzip2", "bz2"], ["xz", "xz"], ["zstd", "zst"]]) {
    for (const keep of [false, true]) test(`${command} ${keep ? "-k" : ""} round trips overlay ${layer} files`, async () => {
      const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
      await ({ upper, lower })[layer].writeFile("/input", bytes("hello world\n"));
      const fs = new OverlayFileSystem({ upper, lower });
      const shell = new Shell({ fs, cwd: "/" }).use(byteCommands());
      const result = await shell.exec(`${command} ${keep ? "-k" : ""} /input`);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect((await fs.stat(`/input.${extension}`)).size).toBeGreaterThan(0);
      const decoded = await shell.exec(`${command} -dc /input.${extension}`);
      expect(decoded.exitCode).toBe(0);
      expect(decoded.stdout).toBe("hello world\n");
      if (keep || command === "zstd") expect(await fs.readFile("/input")).toEqual(bytes("hello world\n"));
      else await expect(fs.stat("/input")).rejects.toMatchObject({ code: "ENOENT" });
      if (layer === "lower") expect(await lower.readFile("/input")).toEqual(bytes("hello world\n"));
    });
  }
  test(`sed -i edits overlay ${layer} files`, async () => {
    const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
    await ({ upper, lower })[layer].writeFile("/input", bytes("hello world\n"));
    const fs = new OverlayFileSystem({ upper, lower });
    const result = await new Shell({ fs, cwd: "/" }).use(textProgramCommands()).exec("sed -i 's/hello/hi/' /input");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(await fs.readFile("/input")).toEqual(bytes("hi world\n"));
  });
  test(`ssconvert publishes overlay output from ${layer} input`, async () => {
    const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
    await ({ upper, lower })[layer].writeFile("/input.csv", bytes("name,age\nAda,36\n"));
    const fs = new OverlayFileSystem({ upper, lower });
    const shell = new Shell({ fs, cwd: "/" }).use(ssconvertCommands());
    const result = await shell.exec("ssconvert /input.csv /output.xlsx");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect((await fs.stat("/output.xlsx")).size).toBeGreaterThan(0);
    const back = await shell.exec("ssconvert /output.xlsx /back.csv");
    expect(back.exitCode).toBe(0);
    expect(new TextDecoder().decode(await fs.readFile("/back.csv"))).toContain("Ada,36");
  });
}

for (const layer of ["upper", "lower"] as const) {
  test(`mv -n preserves existing overlay destinations and moves ${layer} files`, async () => {
    const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
    await ({ upper, lower })[layer].writeFile("/input", bytes("source"));
    await lower.writeFile("/existing", bytes("keep"));
    const fs = new OverlayFileSystem({ upper, lower });
    const shell = new Shell({ fs, cwd: "/" }).use(standardCommands());
    const skipped = await shell.exec("mv -n /input /existing");
    expect(skipped.stderr).toBe("");
    expect(await fs.readFile("/existing")).toEqual(bytes("keep"));
    expect(await fs.readFile("/input")).toEqual(bytes("source"));
    const moved = await shell.exec("mv -n /input /moved");
    expect(moved.exitCode).toBe(0);
    expect(moved.stderr).toBe("");
    expect(await fs.readFile("/moved")).toEqual(bytes("source"));
    await expect(fs.stat("/input")).rejects.toMatchObject({ code: "ENOENT" });
  });
}
