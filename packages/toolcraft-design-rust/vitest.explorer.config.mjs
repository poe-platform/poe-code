import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";
const path=name=>fileURLToPath(new URL(name,import.meta.url));
const suite=path("../toolcraft-design/src/explorer/keymap.test.ts");
export default defineConfig({
  plugins:[{name:"rust-explorer-reference",enforce:"pre",resolveId(name,importer){
    if(importer?.startsWith(path("../toolcraft-design/src/explorer/"))&&name==="./jobs.js")return path("dist/explorer-jobs.js");
    if(importer?.startsWith(path("../toolcraft-design/src/explorer/"))&&["./filter.js","../filter.js"].includes(name))return path("dist/explorer-filter.js");
    if(importer?.startsWith(path("../toolcraft-design/src/explorer/"))&&["./layout.js","../layout.js"].includes(name))return path("dist/explorer-layout.js");
    if(importer?.startsWith(path("../toolcraft-design/src/explorer/"))&&name==="./actions.js")return path("dist/explorer-actions.js");
    if([suite,path("../toolcraft-design/src/explorer/state.test.ts"),path("../toolcraft-design/src/explorer/panes.test.ts")].includes(importer)&&name==="./state.js")return path("dist/explorer-state.js");
    if(importer===suite&&name==="./keymap.js")return path("dist/explorer-keymap.js");
    if(importer===suite&&name==="../dashboard/terminal.js")return path("dist/dashboard-terminal.js");
  }}],
  test:{env:{FORCE_COLOR:process.env.FORCE_COLOR??"1"},include:[suite,path("../toolcraft-design/src/explorer/state.test.ts"),path("../toolcraft-design/src/explorer/panes.test.ts"),path("../toolcraft-design/src/explorer/layout.test.ts"),path("../toolcraft-design/src/explorer/actions.test.ts"),path("../toolcraft-design/src/explorer/filter.test.ts"),path("../toolcraft-design/src/explorer/reducer.test.ts"),path("../toolcraft-design/src/explorer/render/list.test.ts"),path("../toolcraft-design/src/explorer/jobs.test.ts")],environment:"node",fileParallelism:false,maxWorkers:1,pool:"forks",testTimeout:3000,cache:false}
});
