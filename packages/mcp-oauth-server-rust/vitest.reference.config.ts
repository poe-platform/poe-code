import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const referenceRoot=fileURLToPath(new URL("../mcp-oauth-server/src/",import.meta.url));
const nativeIndex=fileURLToPath(new URL("./dist/index.js",import.meta.url));
const nativeOAuth=fileURLToPath(new URL("../mcp-oauth-rust/dist/index.js",import.meta.url));
export default defineConfig({
  root:fileURLToPath(new URL("../../",import.meta.url)),
  plugins:[{
    name:"rust-authorization-server-contract",enforce:"pre",
    resolveId(source,importer) {
      if (!importer?.startsWith(referenceRoot)) return;
      if (source==="./index.js") return nativeIndex;
      if (source==="mcp-oauth") return nativeOAuth;
    },
    transform(code,id) {
      if (!id.startsWith(referenceRoot)||!id.endsWith(".test.ts")) return;
      const factory=id.endsWith("/security.test.ts")?"createAuthorizationInteractionSecurity":"createOAuthAuthorizationServer";
      return {code:code+`\nimport { ${factory} as nativeContractFactory } from ${JSON.stringify(nativeIndex)};\nif (${factory} !== nativeContractFactory) throw new Error("Authorization-server contracts must execute the Rust implementation");`,map:null};
    }
  }],
  test:{include:["packages/mcp-oauth-server/src/**/*.test.ts"],cache:false,testTimeout:2000}
});
