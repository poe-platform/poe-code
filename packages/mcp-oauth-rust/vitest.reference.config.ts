import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const referenceTest = fileURLToPath(new URL("../mcp-oauth/src/mcp-oauth.test.ts", import.meta.url));
const nativeIndex = fileURLToPath(new URL("./dist/index.js", import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  plugins: [
    {
      name: "rust-oauth-reference-contract",
      enforce: "pre",
      resolveId(source, importer) {
        if (importer === referenceTest && source === "./index.js") return nativeIndex;
      },
      transform(code, id) {
        if (id !== referenceTest) return;
        return {
          code:
            code +
            `\nimport { createDefaultOAuthClientProvider as nativeContractFactory } from ${JSON.stringify(nativeIndex)};\nif (createDefaultOAuthClientProvider !== nativeContractFactory) throw new Error("OAuth reference contracts must execute the Rust provider");`,
          map: null
        };
      }
    }
  ],
  test: {
    include: ["packages/mcp-oauth/src/mcp-oauth.test.ts"],
    cache: false,
    testTimeout: 2000
  }
});
