import { readFileSync, existsSync } from "node:fs";
import { expect, test } from "vitest";

const root = new URL("../", import.meta.url);
test("DOCX parsing, discovery and execution belong to the command above the reusable engine", () => {
  for (const file of ["command.ts", "discovery.ts", "inspection-command.ts"]) {
    expect(existsSync(new URL(`packages/safe-bash-command-docx/src/${file}`, root)), file).toBe(true);
    expect(existsSync(new URL(`packages/safe-bash-docx-engine/src/${file}`, root)), file).toBe(false);
  }
  const engine = JSON.parse(readFileSync(new URL("packages/safe-bash-docx-engine/package.json", root), "utf8"));
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    expect(Object.keys(engine[field] ?? {})).not.toContain("safe-bash-command-docx");
  }
});
