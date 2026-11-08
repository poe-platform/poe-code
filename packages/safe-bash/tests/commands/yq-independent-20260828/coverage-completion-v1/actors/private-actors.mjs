import { describeReason } from './own-data.mjs';

export async function observeSession(profile, factory, recorder) {
  const controller = new AbortController();
  const callerReason = { role: 'actor-caller-abort' };
  const local = { callerReason, selectedReason: undefined, hasSelectedReason: false, callReasons: [], cleanupReasons: [] };
  const calls = [];
  const session = factory({ signal: controller.signal });
  let reservation;
  let closePromise;
  const captureCall = async (tag, operation) => {
    recorder.event('private-call-begin', { tag });
    try {
      await operation();
      calls.push({ tag, rejected: false, rejection: null });
      try { recorder.event('private-call-settled', { tag, rejected: false }); } catch {}
    } catch (reason) {
      local.callReasons.push({ tag, reason });
      calls.push({ tag, rejected: true, rejection: describeReason(reason), sameCallerReason: Object.is(reason, callerReason) });
      try { recorder.event('private-call-settled', { tag, rejected: true }); } catch {}
    }
  };
  try {
    recorder.event('session-created');
    const work = session.ownedWork;
    if (profile.recordId === 'WRK-26') {
      const counts = [['negative', -1], ['zero', 0], ['fraction', 1.5], ['nan', NaN], ['infinity', Infinity], ['unsafe', Number.MAX_SAFE_INTEGER + 1]];
      for (const [tag, count] of counts) await captureCall(tag, async () => {
        if (profile.variant === 'reserve') {
          reservation = work.reserve(count);
          if (count === 0) reservation.finish();
          else reservation.abandon();
          reservation = undefined;
        } else await work[profile.variant](count);
      });
      if (profile.variant === 'charge') {
        await captureCall('omitted', () => work.charge());
        await captureCall('one', () => work.charge(1));
      }
    } else if (profile.variant === 'closed-session') {
      closePromise = session.close();
      await closePromise;
      await captureCall('charge-after-close', () => work.charge(1));
    } else {
      if (profile.variant.startsWith('carry-')) await work.charge(1023);
      recorder.event('declared-prefix-complete', { ordinaryUnitsRequested: profile.variant.startsWith('carry-') ? 1023 : 0, privatePendingObserved: false });
      if (profile.variant === 'carry-charge-abort') {
        reservation = work.reserve(0);
        reservation.finish();
        reservation = undefined;
        const pending = work.charge(1);
        controller.abort(callerReason);
        await captureCall('next-charge-after-zero-reservation', () => pending);
      } else {
        reservation = work.reserve(1);
        const pending = reservation.beforeUnit();
        if (profile.variant === 'unit-close') closePromise = session.close();
        else controller.abort(callerReason);
        await captureCall('prepaid-before-unit-after-state-change', () => pending);
      }
    }
  } catch (reason) {
    local.selectedReason = reason;
    local.hasSelectedReason = true;
  } finally {
    try { reservation?.abandon(); } catch (reason) { local.cleanupReasons.push(reason); }
    try { await (closePromise ?? session.close()); } catch (reason) { local.cleanupReasons.push(reason); }
  }
  recorder.guard();
  return { local, facts: { calls, privateCountersObserved: false, sessionCloseAwaited: true, timerOrBudgetSubstitution: false }, cleanupErrors: local.cleanupReasons.map(describeReason) };
}

export async function observeFactory(profile, factory, recorder) {
  const local = { selectedReason: undefined, hasSelectedReason: false, callReasons: [], cleanupReasons: [] };
  const calls = [];
  const captureCall = (tag, operation) => {
    recorder.event('factory-call-begin', { tag });
    try {
      operation();
      calls.push({ tag, rejected: false, rejection: null });
      try { recorder.event('factory-call-settled', { tag, rejected: false }); } catch {}
    } catch (reason) {
      local.callReasons.push({ tag, reason });
      calls.push({ tag, rejected: true, rejection: describeReason(reason) });
      try { recorder.event('factory-call-settled', { tag, rejected: true }); } catch {}
    }
  };
  let getterReads = 0;
  const registrations = [];
  const registry = new Map();
  const snapshots = [];
  const host = { commands: {
    has(name) {
      if (typeof name !== 'string' || name.length > 128) throw new TypeError('bounded registry name');
      recorder.event('registry-has', { name });
      return registry.has(name);
    },
    register(definition, options) {
      const name = Object.getOwnPropertyDescriptor(definition, 'name');
      const replace = Object.getOwnPropertyDescriptor(options, 'replace');
      if (!name || !Object.hasOwn(name, 'value') || typeof name.value !== 'string' || name.value.length > 128 || !replace || !Object.hasOwn(replace, 'value') || typeof replace.value !== 'boolean') throw new TypeError('registry own data required');
      recorder.event('registry-register', { name: name.value, replace: replace.value });
      registrations.push({ name: name.value, replace: replace.value });
      if (registry.has(name.value) && !replace.value) throw new Error('ACTOR_HOST_COLLISION');
      registry.set(name.value, definition);
    },
  } };
  const setup = options => {
    const plugin = factory(options);
    const result = plugin.setup(host);
    if (result !== undefined) throw new TypeError('Actor requires declared synchronous plugin setup');
  };
  if (profile.recordId === 'TYP-05') {
    captureCall('getter-true', () => setup({ get replace() { getterReads++; return true; } }));
    captureCall('invalid-replace', () => setup({ replace: 'true' }));
    captureCall('unknown-own-key', () => setup({ extra: true }));
    captureCall('null-options', () => setup(null));
  } else if (profile.recordId === 'TYP-06') {
    captureCall('first-registration', () => setup(undefined));
    const original = registry.get('yq');
    snapshots.push({ stage: 'before-collision', names: [...registry.keys()] });
    captureCall('duplicate-registration', () => setup(undefined));
    snapshots.push({ stage: 'after-collision', names: [...registry.keys()], sameYqDefinition: registry.get('yq') === original });
    captureCall('explicit-replace', () => setup({ replace: true }));
    snapshots.push({ stage: 'after-replacement', names: [...registry.keys()], sameYqDefinition: registry.get('yq') === original });
  } else captureCall('undefined-replace', () => setup({ replace: undefined }));
  recorder.guard();
  return { local, facts: { calls, getterReads, registrations, snapshots, hostRole: 'scoped actor registry, not root public export integration' }, cleanupErrors: [] };
}
