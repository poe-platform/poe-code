import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("loads canonical bundled skills without host filesystem or Node compatibility", async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("./templates.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", conditions: ["workerd"],
    format: "iife", globalName: "templates", logLevel: "silent"
  });
  const { loadTemplate } = new Function(`${bundle.outputFiles[0].text}; return templates;`)();
  for (const id of ["poe-generate.md", "terminal-pilot.md"]) {
    expect(await loadTemplate(id)).toBe(await readFile(new URL(`./templates/${id}`, import.meta.url), "utf8"));
  }
  await expect(loadTemplate("toString")).rejects.toThrow("Template not found");
  await expect(loadTemplate("../package.json")).rejects.toThrow("Template not found");
});
