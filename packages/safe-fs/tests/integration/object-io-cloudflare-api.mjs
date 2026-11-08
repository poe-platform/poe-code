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
    const errorCodes = [...new Set((Array.isArray(payload?.errors) ? payload.errors : [])
      .map(error => error?.code).filter(code => Number.isSafeInteger(code) && code >= 0))].slice(0, 20);
    return { status: response.status, success: response.ok && payload?.success === true, result: payload?.result, errorCodes };
  };
}

export async function probeCloudflareQualificationApi({ accountId, runId, api }) {
  if (typeof accountId !== 'string' || accountId.length !== 32
    || [...accountId].some(character => !'0123456789abcdef'.includes(character))
    || typeof runId !== 'string' || runId.length === 0 || runId.length > 20
    || [...runId].some(character => !'0123456789'.includes(character))) {
    throw new Error('Invalid Cloudflare qualification probe identity');
  }
  const name = `poe-code-io-${runId}-${randomBytes(6).toString('hex')}`;
  const account = `/accounts/${accountId}`;
  const rows = [];
  for (const [resource, path] of [
    ['worker', `${account}/workers/scripts/${name}`],
    ['bucket', `${account}/r2/buckets/${name}`],
    ['subdomain', `${account}/workers/subdomain`],
  ]) {
    const response = await api(path);
    rows.push({ resource, status: response.status, success: response.success, errorCodes: response.errorCodes ?? [] });
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const api = createCloudflareQualificationApi({ token: process.env.CLOUDFLARE_API_TOKEN });
    const rows = await probeCloudflareQualificationApi({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      runId: process.env.GITHUB_RUN_ID, api });
    console.log(JSON.stringify({ readOnly: true, resources: rows }));
    if (rows[0].status !== 404 || rows[1].status !== 404 || !rows[2].success) process.exitCode = 1;
  } catch {
    console.error('Cloudflare read-only qualification probe failed without exposing upstream response bodies');
    process.exitCode = 1;
  }
}
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
