import { expect, it } from "vitest";
import { resolveSpreadsheetSdkBuilds } from "./bundle-spreadsheets.mjs";

it("builds spreadsheet entrypoints from their declared public exports", () => {
  const manifest = { exports: {
    "./ssconvert": { types: "./packages/safe-bash-command-ssconvert/dist/index.d.ts", import: "./dist/ssconvert/index.js" },
    "./ssconvert/formats/example": { types: "./packages/example-format/dist/index.d.ts", import: "./dist/ssconvert/formats/example.js" },
    "./safe-bash/spreadsheet-ast": { types: "./packages/spreadsheet-ast/dist/index.d.ts", import: "./dist/ssconvert/ast.js" },
    "./csvkit/codecs/example": { types: "./packages/safe-bash-command-csvkit/dist/codecs/example.d.ts", import: "./dist/csvkit/codecs/example.js" },
    "./unrelated": { import: "./dist/unrelated.js" }
  } };
  const recipes = resolveSpreadsheetSdkBuilds("/repo", {}, manifest);
  expect(recipes.map(recipe => recipe.entryPoints)).toEqual([
    { index: "/repo/packages/safe-bash-command-ssconvert/src/index.ts",
      "formats/example": "/repo/packages/example-format/src/index.ts",
      ast: "/repo/packages/spreadsheet-ast/src/index.ts" },
    { "codecs/example": "/repo/packages/safe-bash-command-csvkit/src/codecs/example.ts" }
  ]);
  expect(recipes.map(recipe => recipe.outdir)).toEqual(["/repo/dist/ssconvert", "/repo/dist/csvkit"]);
  expect(recipes.every(recipe => recipe.splitting === true)).toBe(true);
});
