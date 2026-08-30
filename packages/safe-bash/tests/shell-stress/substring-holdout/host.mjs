import assert from 'node:assert/strict';
import { hostCases } from './cases.mjs';

export async function observeHost(library, id) {
  const fixture = hostCases.find(specimen => specimen.id === id);
  assert.ok(fixture);
  const fs = new library.MemoryFileSystem();
  await fs.mkdir('/fixture');
  const shell = new library.Shell({ fs, cwd: '/fixture', env: { PATH: '/nonexistent', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', ...fixture.environment }, limits: fixture.limits }).use(library.agentCommands());
  const controller = new AbortController();
  const reason = new Error('substring-offset-caller-cancel');
  const late = new Error('substring-offset-late-rejection');
  const output = [], marks = [], unhandled = [];
  let offsetEntered = false, lateDelivered = false, caught;
  const onUnhandled = error => unhandled.push(String(error));
  process.on('unhandledRejection', onUnhandled);
  shell.register({ name: 'mark', async execute(context) { marks.push([...context.args]); return { exitCode: 0 }; } });
  shell.register({ name: 'offset', execute() {
    offsetEntered = true;
    setTimeout(() => controller.abort(reason), 2);
    return new Promise((resolve, reject) => setTimeout(() => { lateDelivered = true; reject(late); }, 10));
  } });
  try {
    try { await shell.exec(fixture.script, { signal: controller.signal, stdout: { async write(bytes) { output.push(Buffer.from(bytes)); } } }); }
    catch (error) { caught = error; }
    if (id === 'cancel-offset-host-late-rejection') await new Promise(resolve => setTimeout(resolve, 30));
    const observation = { id, error: caught ? { name: caught.name, message: caught.message, limit: caught.limit ?? null } : null, sameReason: caught === reason, offsetEntered, lateDelivered, stdout: Buffer.concat(output).toString('base64'), marks, unhandled };
    assert.equal(observation.stdout, ''); assert.deepEqual(marks, []); assert.deepEqual(unhandled, []);
    if (id === 'substring-expansion-budget') assert.equal(caught?.limit, 'maxExpansionBytes');
    else { assert.ok(offsetEntered); assert.ok(lateDelivered); assert.equal(caught, reason); }
    return { ...observation, pass: true };
  } finally { process.off('unhandledRejection', onUnhandled); await shell.dispose(); }
}
