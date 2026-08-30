import assert from 'node:assert/strict';

export const SOURCE_COMMIT = '4abbdeec8e34de88ed2cf7bd32be9c06b413c631';
export const SOURCE_REVIEW = 'f17d8dec11190ef40ecac6c175b208a2e29c7fbf';

export function validateAuthorization(grant, expected) {
  assert(grant !== null && typeof grant === 'object' && !Array.isArray(grant));
  const own = name => {
    const descriptor = Object.getOwnPropertyDescriptor(grant, name);
    assert(descriptor && Object.hasOwn(descriptor, 'value') && !Object.hasOwn(descriptor, 'get') && !Object.hasOwn(descriptor, 'set'), 'own data binding: ' + name);
    assert.equal(typeof descriptor.value, 'string', 'string binding: ' + name);
    return descriptor.value;
  };
  const kind = own('authorizationKind');
  assert(['INDEPENDENT_PRODUCER_REVIEW', 'ROOT_SOURCE_ACCEPTED_AUTHOR_BUILD'].includes(kind), 'unknown authorization kind');
  const common = ['authorizationKind', 'action', 'presealSha256', 'composition', 'outputRoot', 'sourceCommit', 'sourcePureReview'];
  const branch = kind === 'ROOT_SOURCE_ACCEPTED_AUTHOR_BUILD' ? ['rootAuthorBuildDecisionSha256'] : ['independentProducerReview'];
  const keys = Reflect.ownKeys(grant);
  assert.equal(keys.length, common.length + branch.length, 'exact grant fields');
  for (const key of keys) assert(typeof key === 'string' && [...common, ...branch].includes(key), 'unknown grant field');
  for (const key of ['action', 'presealSha256', 'composition', 'outputRoot']) assert.equal(own(key), expected[key], 'bound ' + key);
  assert.equal(own('sourceCommit'), SOURCE_COMMIT, 'exact accepted source');
  assert.equal(own('sourcePureReview'), SOURCE_REVIEW, 'exact SOURCE/PURE review');
  if (kind === 'ROOT_SOURCE_ACCEPTED_AUTHOR_BUILD') {
    assert.equal(own('rootAuthorBuildDecisionSha256'), expected.rootAuthorBuildDecisionSha256, 'exact ROOT decision');
    assert(/^[a-f0-9]{64}$/.test(expected.rootAuthorBuildDecisionSha256));
    return Object.freeze({ kind, sourceCommit: SOURCE_COMMIT, sourcePureReview: SOURCE_REVIEW, independentProducerReview: null, authority: 'explicit ROOT author build, independent actual audit afterward' });
  }
  const review = own('independentProducerReview');
  assert(/^[a-f0-9]{40}$/.test(review));
  assert.notEqual(review, SOURCE_REVIEW, 'SOURCE review is not producer review');
  return Object.freeze({ kind, sourceCommit: SOURCE_COMMIT, sourcePureReview: SOURCE_REVIEW, independentProducerReview: review });
}
