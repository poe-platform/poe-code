import { requireThat } from '../executor-preparation-v1/core.mjs';

export async function publicAdmission(shell, names, emit, signal) {
  let admitted;
  let actual;
  const barrier = new Promise(resolve => { admitted = resolve; });
  shell.use({ name: 'breadth-admission-v2', setup(host) {
    actual = host.commands.list().map(definition => definition.name).sort();
    emit({ kind: 'admission-barrier', names: actual, commandsAdded: 0 });
    admitted();
  } });
  emit({ kind: 'setup-exec-start', source: '', separateFromSemanticCase: true });
  try {
    const result = await shell.exec('', { signal });
    emit({ kind: 'setup-exec-result', exitCode: result.exitCode, stdoutBase64: Buffer.from(result.stdoutBytes).toString('base64'), stderrBase64: Buffer.from(result.stderrBytes).toString('base64') });
    requireThat(result.exitCode === 0 && result.stdoutBytes.length === 0 && result.stderrBytes.length === 0, 'SETUP_EXEC_RESULT', result.exitCode);
    await barrier;
    requireThat(JSON.stringify(actual) === JSON.stringify([...names].sort()), 'DEFAULT_NAMES', actual);
  } catch (error) {
    emit({ kind: 'setup-exec-rejected', name: error?.name, message: String(error?.message ?? error), code: error?.code });
    throw error;
  }
}
