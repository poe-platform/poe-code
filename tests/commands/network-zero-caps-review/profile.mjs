export const baselineCommit = 'bdb49bb1c2b2c5646e1ed8666bf53ebf3bb6433c';
export const huge = Number.MAX_SAFE_INTEGER;
export const defaults = {
  maxUploadBytes: 67108864, maxDownloadBytes: 67108864, maxBufferBytes: 8388608,
  maxHeaderBytes: 65536, maxRedirects: 10, maxRetries: 5, maxUrls: 32, maxTimeMs: 120000,
};
export const invalid = [
  ['negative', -1], ['fraction', 0.5], ['nan', NaN], ['infinity', Infinity],
  ['unsafe', 9007199254740992], ['null', null], ['string', '0'], ['undefined', undefined],
];
export function cases() {
  const output = [];
  const add = (name, limits, args, responses, expected, extra = {}) => output.push({
    name, limits, args, responses, expected, ...extra,
  });
  for (const status of [307, 308]) {
    for (const upload of [false, true]) {
      add(`redirect-${status}-zero-upload-${upload}`, { maxRedirects: 0, maxRetries: 0 },
        ['-L', '--max-redirs', String(huge), '--retry', String(huge)], [status, 200],
        { exit: 47, requests: 1, auth: 1, disposals: 1, body: '', reads: upload ? 1 : 0 }, { upload });
      add(`redirect-${status}-cli-zero-upload-${upload}`, { maxRedirects: 1, maxRetries: 1 },
        ['-L', '--max-redirs', '0', '--retry', '0'], [status, 200],
        { exit: 47, requests: 1, auth: 1, disposals: 1, body: '', reads: upload ? 1 : 0 }, { upload });
    }
    add(`redirect-${status}-one-independent`, { maxRedirects: 1, maxRetries: 0 },
      ['-L', '--max-redirs', String(huge), '--retry', String(huge)], [status, 200],
      { exit: 0, requests: 2, auth: 2, disposals: 2, body: 'body-200', reads: 2 }, { upload: true });
    add(`redirect-${status}-one-exhausted`, { maxRedirects: 1, maxRetries: 0 },
      ['-L', '--max-redirs', String(huge)], [status, status, 200],
      { exit: 47, requests: 2, auth: 2, disposals: 2, body: '', reads: 2 }, { upload: true });
  }
  for (const status of [429, 503]) {
    for (const flag of ['', '--fail', '--fail-with-body']) {
      for (const upload of [false, true]) {
        const expected = { exit: flag ? 22 : 0, requests: 1, auth: 1, disposals: 1,
          body: flag === '--fail' ? '' : `body-${status}`, reads: upload ? 1 : 0 };
        add(`retry-${status}-zero-${flag || 'normal'}-upload-${upload}`,
          { maxRedirects: 0, maxRetries: 0, maxTimeMs: 2000 },
          ['--retry', String(huge), ...(flag ? [flag] : [])], [status, 200], expected,
          { upload, retryAfter: '600' });
        add(`retry-${status}-cli-zero-${flag || 'normal'}-upload-${upload}`,
          { maxRedirects: 1, maxRetries: 1, maxTimeMs: 2000 },
          ['--retry', '0', ...(flag ? [flag] : [])], [status, 200], expected,
          { upload, retryAfter: '600' });
      }
    }
    add(`retry-${status}-one-independent`, { maxRedirects: 0, maxRetries: 1 },
      ['--retry', String(huge), '--retry-delay', '0.001'], [status, 200],
      { exit: 0, requests: 2, auth: 2, disposals: 2, body: 'body-200', reads: 2 }, { upload: true });
    add(`retry-${status}-one-exhausted`, { maxRedirects: 0, maxRetries: 1 },
      ['--retry', String(huge), '--retry-delay', '0.001'], [status, status, 200],
      { exit: 0, requests: 2, auth: 2, disposals: 2, body: `body-${status}`, reads: 2 }, { upload: true });
  }
  add('two-input-urls-both-zero', { maxRedirects: 0, maxRetries: 0 },
    ['-L', '--retry', String(huge)], [200, 200],
    { exit: 0, requests: 2, auth: 2, disposals: 2, body: 'body-200body-200', reads: 2 },
    { upload: true, urls: 2 });
  add('zero-no-follow-initial-body', { maxRedirects: 0, maxRetries: 0 }, [], [307],
    { exit: 0, requests: 1, auth: 1, disposals: 1, body: 'body-307', reads: 0 });
  add('initial-denial', { maxRedirects: 0, maxRetries: 0 }, [], [200],
    { exit: 7, requests: 0, auth: 1, disposals: 0, body: '', reads: 0 }, { upload: true, deny: 1 });
  add('redirect-denial', { maxRedirects: 1, maxRetries: 0 }, ['-L'], [308, 200],
    { exit: 7, requests: 1, auth: 2, disposals: 1, body: '', reads: 1 }, { upload: true, deny: 2 });
  add('retry-denial', { maxRedirects: 0, maxRetries: 1 }, ['--retry', '1', '--retry-delay', '0.001'], [503, 200],
    { exit: 7, requests: 1, auth: 2, disposals: 1, body: '', reads: 1 }, { upload: true, deny: 2 });
  for (const maxRetries of [0, 1, 5]) {
    add(`transport-error-${maxRetries}`, { maxRedirects: 0, maxRetries }, ['--retry', String(huge)], ['error'],
      { exit: 7, requests: 1, auth: 1, disposals: 0, body: '', reads: 1 }, { upload: true });
  }
  add('abort-response', { maxRedirects: 0, maxRetries: 0 }, [], ['abort'],
    { requests: 1, auth: 1, disposals: 1, body: '', reads: 1 }, { upload: true, abort: true });
  add('redirect-default-ten', {}, ['-L', '--max-redirs', String(huge)], Array(11).fill(307),
    { exit: 47, requests: 11, auth: 11, disposals: 11, body: '', reads: 0 });
  add('retry-default-five', {}, ['--retry', String(huge), '--retry-delay', '0.001'], Array(6).fill(503),
    { exit: 0, requests: 6, auth: 6, disposals: 6, body: 'body-503', reads: 0 });
  add('default-cli-no-retry', {}, [], [503, 200],
    { exit: 0, requests: 1, auth: 1, disposals: 1, body: 'body-503', reads: 0 });
  add('max-safe-success', { maxRedirects: huge, maxRetries: huge }, ['-L', '--retry', String(huge)], [200],
    { exit: 0, requests: 1, auth: 1, disposals: 1, body: 'body-200', reads: 0 });
  return output;
}
