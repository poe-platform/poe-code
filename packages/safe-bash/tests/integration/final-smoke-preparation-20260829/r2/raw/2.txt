import assert from 'node:assert/strict';
import { ids, validateSelection } from './contract.mjs';
export async function runSelected(context) {
  validateSelection(context.ids, context.layout);
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
    shell.use(context.api.agentCommands());
    let primaryPresent = false, primary, execution;
    try {
      execution = await shell.exec(original.script);
      assert.equal(execution.stdout, original.stdout); assert.equal(execution.exitCode, original.exitCode);
    } catch (reason) { primaryPresent = true; primary = reason; }
    let cleanupPresent = false, cleanup;
    try { await shell.dispose(); } catch (reason) { cleanupPresent = true; cleanup = reason; }
    context.observe({ id, primaryPresent, primary, cleanupPresent, cleanup });
    if (primaryPresent) throw primary;
    if (cleanupPresent) throw cleanup;
    rows.push({ id, status:'PASS', stdout:execution.stdout, stderr:execution.stderr, exitCode:execution.exitCode });
  }
  return { layout:context.layout, rows };
}
