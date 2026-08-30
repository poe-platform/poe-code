export async function originalGroup({ shell, deferred, track, within, stillPending, assert }) {
  const variants = [];
  for (const caller of ['none', 0, false, '', { code: 'ENOENT' }]) {
    const instance = shell();
    const controller = new AbortController();
    const primary = new Error('selected execution failure');
    const gate = deferred();
    const started = deferred();
    let cleanups = 0;
    instance.register({ name: 'owned', execute(context) {
      context.registerCleanup(async () => { cleanups++; started.release(); await gate.promise; throw new Error('secondary cleanup failure'); });
      context.registerCleanup(() => { cleanups++; throw new Error('other secondary cleanup failure'); });
      throw primary;
    } });
    const running = track(instance.exec('owned', { signal: controller.signal }));
    await within(started.promise);
    if (caller !== 'none') controller.abort(caller);
    await stillPending(running);
    gate.release();
    const result = await within(running);
    assert.equal(result.resolved, false);
    assert.equal(result.error, caller === 'none' ? primary : caller);
    assert.equal(cleanups, 2);
    assert.deepEqual(Object.keys(primary), []);
    variants.push(caller);
  }
  return { variants };
}
