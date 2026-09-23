import { describe, expect, it } from "vitest";
import { dump, restore, run } from "./index.js";

describe("explicit import specifiers", () => {
  const source = 'import {value} from "node:fs/promises"; const read = () => value; return read();';
  const modules = { "node:fs/promises": { value: "virtual" } };
  const importSpecifiers = ["node:fs/promises"];

  it("keeps the default parser restriction even for registered modules", async () => {
    await expect(run(source, { modules })).rejects.toThrow("Invalid import specifier");
  });

  it("admits the exact explicit name and still resolves through the registry", async () => {
    await expect(run(source, { modules, importSpecifiers })).resolves.toMatchObject({ ok: true, returnValue: "virtual" });
    await expect(run(source, { importSpecifiers })).rejects.toThrow("Unknown module");
    await expect(run(source, { modules, importSpecifiers: ["fs/promises"] })).rejects.toThrow("Invalid import specifier");
  });

  it("requires the allowlist again when restoring or replaying a snapshot", async () => {
    const result = await run(source, { modules, importSpecifiers });
    const snapshot = JSON.parse(await dump(result));
    expect(() => restore(snapshot, { source })).toThrow("Invalid import specifier");
    expect(() => restore(snapshot, { source, importSpecifiers })).not.toThrow();
    await expect(run(source, { modules, importSpecifiers, snapshot })).resolves.toMatchObject({ ok: true, returnValue: "virtual" });
  });
});
