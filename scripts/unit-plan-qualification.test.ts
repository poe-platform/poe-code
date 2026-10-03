import {fileURLToPath} from "node:url";
import {expect,it} from "vitest";
import {createWorkspaceTestPlan} from "./build-workspaces.mjs";
it("admits maintained unit declarations and builds generated source resources",()=>{
 const plan=createWorkspaceTestPlan(fileURLToPath(new URL("../",import.meta.url)));
 expect(plan.testStages.some(stage=>stage.path===null)).toBe(true);
 const builds=new Set(plan.buildStages.map(stage=>stage.name));
 for(const owner of ["@poe-code/superintendent","@poe-code/poe-agent","@poe-code/agent-skill-config","@poe-code/agent-gaslight","@poe-code/agent-harness","@poe-code/experiment-loop"])expect(builds.has(owner),owner).toBe(true);
});
it.each(["@poe-code/memory","@poe-code/agent-hook-config","@poe-code/pipeline","@poe-code/ralph","@poe-code/poe-acp-client","toolcraft"])("builds %s self-imports when its unit task is selected alone",owner=>{
 const plan=createWorkspaceTestPlan(fileURLToPath(new URL("../",import.meta.url)),{workspaces:[owner]});
 expect(plan.buildStages.some(stage=>stage.name===owner)).toBe(true);
});
