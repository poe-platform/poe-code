import assert from 'node:assert/strict';
import { runSuite } from './runtime.mjs';

export async function runMutations(root, network) {
  const variants = [
    { name: 'reject-zero-constructor', select: 'redirect-307-zero-upload-true',
      change(_options) { throw new RangeError('mutation rejects zero constructor'); } },
    { name: 'raise-zero-redirect-to-one', select: 'redirect-307-zero-upload-true',
      change: options => ({ ...options, limits: { ...options.limits, maxRedirects: 1 } }) },
    { name: 'raise-zero-retry-to-one', select: 'retry-503-zero-normal-upload-true',
      change: options => ({ ...options, limits: { ...options.limits, maxRetries: 1 } }) },
    { name: 'blanket-refuse-positive-redirect', select: 'redirect-308-one-independent',
      change: options => ({ ...options, limits: { ...options.limits, maxRedirects: 0 } }) },
    { name: 'blanket-refuse-positive-retry', select: 'retry-429-one-independent',
      change: options => ({ ...options, limits: { ...options.limits, maxRetries: 0 } }) },
    { name: 'ignore-initial-authorization', select: 'initial-denial',
      change: options => ({ ...options, authorize: async request => { await options.authorize(request); return true; } }) },
    { name: 'omit-response-disposal', select: 'zero-no-follow-initial-body',
      change: options => ({ ...options, transport: async request => ({ ...await options.transport(request), async dispose() {} }) }) },
  ];
  const receipts = [];
  for (const variant of variants) {
    const mutated = { ...network,
      createCurlCommand: options => network.createCurlCommand(variant.change(options)),
      networkCommands: options => network.networkCommands(variant.change(options)),
    };
    const result = await runSuite(root, mutated, { validators: false, select: spec => spec.name === variant.select });
    assert.equal(result.counts.passed, 0, `${variant.name} escaped detection`);
    assert.equal(result.counts.failed, 2, `${variant.name} must fail direct and Shell controls`);
    receipts.push({ mutation: variant.name, detected: true, fixture: variant.select,
      directAndShellFailures: result.receipts.map(item => ({ name: item.name, error: item.error.split('\n').slice(0, 10).join('\n') })) });
  }
  return { mutations: variants.length, detected: receipts.length, executions: variants.length * 2, receipts };
}
