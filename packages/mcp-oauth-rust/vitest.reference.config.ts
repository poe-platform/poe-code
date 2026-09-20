import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const referenceTest = fileURLToPath(new URL("../mcp-oauth/src/mcp-oauth.test.ts", import.meta.url));
const nativeIndex = fileURLToPath(new URL("./dist/index.js", import.meta.url));
const verifierTests = ["server-token-verifier.test.ts", "jwks-configuration.test.ts", "jwks-body-ownership.test.ts"].map(name => fileURLToPath(new URL(`../mcp-oauth/src/${name}`, import.meta.url)));
export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  plugins: [
    {
      name: "rust-oauth-reference-contract",
      enforce: "pre",
      resolveId(source, importer) {
        if ((importer === referenceTest || verifierTests.includes(importer ?? "")) && source === "./index.js") return nativeIndex;
      },
      transform(code, id) {
        if (verifierTests.includes(id)) return {
          code: code + `\nimport { createJwksTokenVerifier as nativeVerifierFactory } from ${JSON.stringify(nativeIndex)};\nif (createJwksTokenVerifier !== nativeVerifierFactory) throw new Error("JWKS reference contracts must execute the Rust verifier");`,
          map: null
        };
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
    include: ["packages/mcp-oauth/src/mcp-oauth.test.ts", ...verifierTests],
    cache: false,
    testTimeout: 2000
  }
});
