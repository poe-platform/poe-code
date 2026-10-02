import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";
const path=name=>fileURLToPath(new URL(name,import.meta.url));
const suite=path("../toolcraft-design/src/prompts/prompts.test.ts");
export default defineConfig({
  plugins:[{
    name:"rust-with-spinner-reference",enforce:"pre",
    resolveId(name,importer){
      if(importer!==suite)return;
      if(name==="./index.js")return path("dist/with-spinner.js");
      if(name==="./primitives/spinner.js")return path("dist/spinner.js");
      if(name==="../internal/output-format.js")return path("dist/logging.js");
    }
  }],
  test:{
    include:[suite],
    // confirmOrCancel remains unported; do not route it through the reference.
    testNamePattern:"^withSpinner ",
    environment:"node",fileParallelism:false,maxWorkers:1,pool:"forks",testTimeout:3000,cache:false
  }
});
