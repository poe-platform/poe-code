import assert from 'node:assert/strict';
import { ids, validateSelection } from '../contract.mjs';
export async function runSelected(context, observations = []) {
  validateSelection(context.ids, context.layout);
  assert(Array.isArray(observations));
  const rows = [];
  for (let index = 0; index < ids.length; index++) {
    await context.beforeCase(index);
    const id = ids[index];
    if (id.startsWith('C')) {
      rows.push(await context.runWorkflow(id, { api:context.api, nodeApi:context.nodeApi, fixture:context.fixture }));
      continue;
    }
    const original = context.scalarAndPipelineRows.find(row => row.id === id); assert(original);
    const shell = new context.api.Shell({ fs:new context.api.MemoryFileSystem(), cwd:'/', env:{} });
    let primaryPresent = false, primary, execution;
    try {
      shell.use(context.api.agentCommands());
      execution = await shell.exec(original.script);
      assert.equal(execution.stdout, original.stdout); assert.equal(execution.exitCode, original.exitCode);
    } catch (reason) { primaryPresent = true; primary = reason; }
    let cleanupPresent = false, cleanup;
    try { await shell.dispose(); } catch (reason) { cleanupPresent = true; cleanup = reason; }
    const observation = { id, primaryPresent, primary, cleanupPresent, cleanup, reportingPresent:false, reporting:undefined };
    let collectionPresent = false, collection;
    try { observations.push(observation); } catch (reason) { collectionPresent = true; collection = reason; }
    try { await context.observe(observation); }
    catch (reason) { observation.reportingPresent = true; observation.reporting = reason; }
    if (primaryPresent) throw primary;
    if (cleanupPresent) throw cleanup;
    if (collectionPresent) throw collection;
    if (observation.reportingPresent) throw observation.reporting;
    rows.push({ id, status:'PASS', stdout:execution.stdout, stderr:execution.stderr, exitCode:execution.exitCode });
  }
  return { layout:context.layout, rows };
}
