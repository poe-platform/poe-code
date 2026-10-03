import {fileURLToPath} from "node:url";
import {expect,it} from "vitest";
import {createWorkspaceTestPlan} from "./build-workspaces.mjs";
it("admits maintained unit declarations and builds generated source resources",()=>{
 const plan=createWorkspaceTestPlan(fileURLToPath(new URL("../",import.meta.url)));
 expect(plan.testStages.some(stage=>stage.path===null)).toBe(true);
 const builds=new Set(plan.buildStages.map(stage=>stage.name));
 for(const owner of ["@poe-code/superintendent","@poe-code/poe-agent","@poe-code/agent-skill-config"])expect(builds.has(owner),owner).toBe(true);
});
