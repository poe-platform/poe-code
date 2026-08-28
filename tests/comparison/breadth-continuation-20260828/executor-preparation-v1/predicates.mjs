const within = path => path === '/fixture' || path.startsWith('/fixture/');
export function assessWorkflow(specimen, report) {
  const checks = [];
  const check = (id, pass, detail) => checks.push({ id, pass: Boolean(pass), detail });
  check('NO_CAPTURE_ERROR', !report.error);
  check('COMPLETE_CENSUS', report.before?.complete && report.after?.complete);
  check('STATUS', report.result?.exitCode === specimen.expected.exitCode, report.result?.exitCode);
  check('STDOUT_BYTES', report.result?.stdoutBase64 === specimen.expected.stdoutBase64);
  check('STDERR_BYTES', report.result?.stderrBase64 === specimen.expected.stderrBase64);
  for (const observation of specimen.additionalObservations ?? []) check(`OBSERVATION:${observation}`, report.additionalObservations?.[observation] === true);
  const before = new Map((report.before?.entries ?? []).filter(entry => within(entry.path)).map(entry => [entry.path, entry]));
  const after = new Map((report.after?.entries ?? []).filter(entry => within(entry.path)).map(entry => [entry.path, entry]));
  for (const [name, file] of Object.entries(specimen.files)) {
    const filename = `/fixture/${name}`;
    const initial = before.get(filename);
    const current = after.get(filename);
    check(`INITIAL:${name}`, initial?.type === 'file' && initial.base64 === file.base64 && (initial.mode & 0o7777) === file.mode);
    check(`PRESERVE:${name}`, current?.type === 'file' && current.base64 === file.base64 && (current.mode & 0o7777) === file.mode);
  }
  const expectedPaths = new Set(before.keys());
  for (const [name, file] of Object.entries(specimen.expected.addedFiles)) {
    const filename = `/fixture/${name}`;
    expectedPaths.add(filename);
    check(`ADDED:${name}`, after.get(filename)?.type === 'file' && after.get(filename)?.base64 === file.base64);
  }
  for (const name of specimen.expected.absent) {
    expectedPaths.delete(`/fixture/${name}`);
    check(`ABSENT:${name}`, !after.has(`/fixture/${name}`));
  }
  check('EXACT_NAMESPACE', JSON.stringify([...after.keys()].sort()) === JSON.stringify([...expectedPaths].sort()));
  return { checks, pass: checks.every(item => item.pass) };
}
export async function admissionBarrier(shell, names, observe) {
  let admitted;
  const barrier = new Promise(resolve => { admitted = resolve; });
  shell.use({ name: 'breadth-admission', setup(host) {
    const actual = host.commands.list().map(definition => definition.name).sort();
    observe({ kind: 'admission', names: actual, commandsRegisteredByHarness: 0 });
    admitted(actual);
  } });
  const actual = await barrier;
  if (JSON.stringify(actual) !== JSON.stringify([...names].sort())) throw Object.assign(new Error('DEFAULT_NAMES'), { code: 'DEFAULT_NAMES' });
}
