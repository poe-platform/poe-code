import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";
const path=name=>fileURLToPath(new URL(name,import.meta.url));
const suite=path("../toolcraft-design/src/explorer/keymap.test.ts");
export default defineConfig({
  plugins:[{name:"rust-explorer-reference",enforce:"pre",resolveId(name,importer){
    if(importer===suite&&name==="./keymap.js")return path("dist/explorer-keymap.js");
    if(importer===suite&&name==="../dashboard/terminal.js")return path("dist/dashboard-terminal.js");
  }}],
  test:{include:[suite],environment:"node",fileParallelism:false,maxWorkers:1,pool:"forks",testTimeout:3000,cache:false}
});
