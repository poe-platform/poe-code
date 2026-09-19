export function createCloudflareQualificationApi({ token, fetch = globalThis.fetch }) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('Cloudflare deployment token required');
  return async (path, options = {}) => {
    if (typeof path !== 'string' || !path.startsWith('/accounts/')
      || path.split('/').some(segment => segment === '.' || segment === '..')
      || [...path].some(character => !'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/_-'.includes(character))) {
      throw new Error('Invalid Cloudflare qualification API path');
    }
    const headers = { Authorization: `Bearer ${token}` };
    let body = options.body;
    if (body !== undefined && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method: options.method ?? 'GET', headers, body, redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body ?? []) {
      bytes += chunk.byteLength;
      if (bytes > 1048576) throw new Error('Cloudflare qualification API response exceeds byte limit');
      chunks.push(chunk);
    }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); }
    catch { throw new Error(`Cloudflare qualification API returned non-JSON status ${response.status}`); }
    return { status: response.status, success: response.ok && payload?.success === true, result: payload?.result };
  };
}
