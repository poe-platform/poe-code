import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";
const path=name=>fileURLToPath(new URL(name,import.meta.url));
const suite=path("../toolcraft-design/src/prompts/prompts.test.ts");
export default defineConfig({
  plugins:[{
    name:"rust-prompts-reference",enforce:"pre",
    resolveId(name,importer){
      if(importer!==suite)return;
      if(name==="./index.js")return path("dist/prompts.js");
      if(name==="./interactive/confirm.js")return path("dist/prompt-confirm.js");
      if(name==="./primitives/cancel.js")return path("dist/prompt-cancel-primitive.js");
      if(name==="./primitives/spinner.js")return path("dist/spinner.js");
      if(name==="../internal/output-format.js")return path("dist/logging.js");
    }
  }],
  test:{
    include:[suite],
    environment:"node",fileParallelism:false,maxWorkers:1,pool:"forks",testTimeout:3000,cache:false
  }
});
