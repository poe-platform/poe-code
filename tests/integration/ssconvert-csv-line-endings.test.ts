import { expect, it } from "vitest";
import { Shell, createSsconvertCommand } from "../../packages/safe-bash/src/core.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";

it.each(["\n", "\r\n", "\r"])("preserves CSV terminator %j through the public command", async ending => {
  const fs = new MemoryFileSystem();
  const bytes = new TextEncoder().encode(["a,b", "1,2", ""].join(ending));
  await fs.writeFile("/input.csv", bytes);
  const shell = new Shell({ fs });
  shell.register(createSsconvertCommand());
  try {
    const result = await shell.exec("ssconvert -I Gnumeric_stf:stf_csvtab -T Gnumeric_stf:stf_csv /input.csv /output.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(await fs.readFile("/output.csv")).toEqual(bytes);
  } finally { await shell.dispose(); }
});
