import manifest from "../../package.json" with { type: "json" };
import { Document, DocumentBudget } from "../../src/sdk.js";

// A data module is external to Vitest's source aliases. Node loads the declared
// public import target and its complete compiled dependency graph.
export const compiledPublicRuntime = (import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(
  `export * from ${JSON.stringify(new URL("../../" + manifest.exports["./sdk"].import, import.meta.url).href)};`
).toString("base64")}`) as Promise<typeof import("../../src/sdk.js")>).then(runtime => {
  if (runtime.Document === Document || runtime.DocumentBudget === DocumentBudget)
    throw new Error("Compiled public runtime was replaced by a source alias.");
  return runtime;
});
