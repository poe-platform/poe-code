import { expect, it } from "vitest";
import {
  Shell, createSsconvertCommand, createSsconvertCommands, ssconvertCommands,
  type SsconvertCommandsOptions
} from "../../packages/safe-bash/src/core.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";

it.each(["plugin", "single", "collection"] as const)(
  "recalculates long SYLK formulas through the zero-argument core %s factory", async factory => {
    const fs = new MemoryFileSystem();
    const formula = Array(130).fill("1").join("+");
    await fs.writeFile("/in.slk", new TextEncoder().encode(`ID;PGnumeric\nC;Y1;X1;K0;E${formula}\nE\n`));
    const shell = new Shell({ fs });
    if (factory === "plugin") shell.use(ssconvertCommands());
    else for (const command of factory === "single" ? [createSsconvertCommand()] : createSsconvertCommands()) shell.register(command);
    try {
      const result = await shell.exec("ssconvert --recalc /in.slk /out.csv");
      expect(result.stderr).toBe("1:Unknown directive 'ID;PGnumeric'\n");
      expect(result.exitCode).toBe(0);
      expect(new TextDecoder().decode(await fs.readFile("/out.csv"))).toBe("130\n");
    } finally { await shell.dispose(); }
  }
);

it("retains explicit formula ceilings through the core plugin", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.slk", new TextEncoder().encode("ID;PGnumeric\nC;Y1;X1;K0;E1+1+1+1\nE\n"));
  const options: SsconvertCommandsOptions = { limits: { formulaDepth: 2 } };
  const shell = new Shell({ fs }).use(ssconvertCommands(options));
  try {
    const result = await shell.exec("ssconvert --recalc /in.slk /out.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("formula depth limit exceeded");
    await expect(fs.readFile("/out.csv")).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await shell.dispose(); }
});

it("recalculates dynamic dependencies beyond the former 128-cell ceiling", async () => {
  const fs = new MemoryFileSystem();
  const rows = Array.from({ length: 130 }, (_, row) =>
    `C;Y${row + 1};X1;K1${row < 129 ? ';EINDIRECT("A"&(ROW()+1))+1' : ''}`);
  await fs.writeFile("/in.slk", new TextEncoder().encode(["ID;PGnumeric", ...rows, "E", ""].join("\n")));
  const shell = new Shell({ fs }).use(ssconvertCommands());
  try {
    const result = await shell.exec("ssconvert --recalc /in.slk /out.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("1:Unknown directive 'ID;PGnumeric'\n");
    expect(new TextDecoder().decode(await fs.readFile("/out.csv")))
      .toBe(Array.from({ length: 130 }, (_, row) => `${130 - row}\n`).join(""));
  } finally { await shell.dispose(); }
});
