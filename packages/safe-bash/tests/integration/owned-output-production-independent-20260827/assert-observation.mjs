import assert from 'node:assert/strict';

export function assertObservation(fixture, observation) {
  assert.equal(observation.id, fixture.id, 'case identity');
  assert.ok(Array.isArray(observation.events), 'events required');
  assert.ok(observation.events.every(event => typeof event === 'string'), 'event labels must be strings');
  assert.ok(observation.values && typeof observation.values === 'object', 'values required');
  for (const [name, value] of Object.entries(fixture.expected.values ?? {})) {
    assert.ok(Object.hasOwn(observation.values, name), `missing ${name}`);
    assert.deepEqual(observation.values[name], value, `${fixture.id}: ${name}`);
  }
  for (const [earlier, later] of fixture.expected.before ?? []) {
    const earlierIndex = observation.events.indexOf(earlier);
    const laterIndex = observation.events.indexOf(later);
    assert.ok(earlierIndex >= 0 && laterIndex >= 0, `${fixture.id}: missing ordered events ${earlier}, ${later}`);
    assert.ok(earlierIndex < laterIndex, `${fixture.id}: ${earlier} must precede ${later}`);
  }
}
