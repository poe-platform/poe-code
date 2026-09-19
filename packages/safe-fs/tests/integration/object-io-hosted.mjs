import { createHash } from 'node:crypto';

export async function admitObjectIoArtifacts({ manifest, readArtifact }) {
  const entries = manifest?.artifacts;
  const date = manifest?.compatibilityDate;
  if (typeof date !== 'string' || date.length !== 10 || !Number.isFinite(Date.parse(date))) {
    throw new Error('Invalid artifact compatibility date');
  }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 128) {
    throw new Error('Invalid artifact module count');
  }
  const names = new Set();
  const modules = [];
  let total = 0;
  for (const entry of entries) {
    if (typeof entry.name !== 'string' || entry.name.length > 128 || entry.name.length === 0
      || entry.name === '.' || entry.name === '..'
      || [...entry.name].some(character => !'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-'.includes(character))
      || names.has(entry.name)) {
      throw new Error('Invalid or duplicate artifact name');
    }
    if (!['ESModule', 'CompiledWasm', 'Data'].includes(entry.type)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 16 * 1024 * 1024) {
      throw new Error('Invalid artifact type or size');
    }
    total += entry.bytes;
    if (total > 32 * 1024 * 1024) throw new Error('Artifact exceeds total byte limit');
    names.add(entry.name);
    const contents = await readArtifact(entry.name);
    if (!(contents instanceof Uint8Array) || contents.byteLength !== entry.bytes
      || createHash('sha256').update(contents).digest('hex') !== entry.sha256) {
      throw new Error('Artifact byte authentication failed');
    }
    modules.push({ name: entry.name, type: entry.type, contents: Uint8Array.from(contents) });
  }
  const mains = modules.filter(module => module.type === 'ESModule');
  if (mains.length !== 1) throw new Error('Artifact requires exactly one main module');
  return { mainModule: mains[0].name, compatibilityDate: date, modules };
}

export async function runHostedObjectIoQualification({
  accountId, nonce, token, runId, sourceRevision, artifact, api, qualify, clean,
}) {
  const hexadecimal = '0123456789abcdef';
  if (typeof accountId !== 'string' || accountId.length !== 32
    || [...accountId].some(character => !hexadecimal.includes(character))
    || typeof nonce !== 'string' || nonce.length !== 32
    || [...nonce].some(character => !hexadecimal.includes(character))
    || typeof runId !== 'string' || runId.length === 0 || runId.length > 20
    || [...runId].some(character => !'0123456789'.includes(character))
    || typeof token !== 'string' || token.length < 32
    || typeof sourceRevision !== 'string' || sourceRevision.length !== 40
    || [...sourceRevision].some(character => !hexadecimal.includes(character))) {
    throw new Error('Invalid hosted qualification identity');
  }
  const name = `poe-code-io-${runId}-${nonce.slice(0, 12)}`;
  const account = `/accounts/${accountId}`;
  const worker = `${account}/workers/scripts/${name}`;
  const bucket = `${account}/r2/buckets/${name}`;
  for (const path of [worker, bucket]) {
    const existing = await api(path);
    if (existing.status !== 404) throw new Error('Hosted preflight requires absent resources');
  }
  const subdomain = await api(`${account}/workers/subdomain`);
  if (!subdomain.success || typeof subdomain.result?.subdomain !== 'string'
    || subdomain.result.subdomain.length === 0
    || [...subdomain.result.subdomain].some(character => !'abcdefghijklmnopqrstuvwxyz0123456789-'.includes(character))) {
    throw new Error('Hosted account subdomain unavailable');
  }
  const url = `https://${name}.${subdomain.result.subdomain}.workers.dev`;
  const receipt = { workerName: name, bucketName: name, sourceRevision, cleanupComplete: false };
  let bucketAttempted = false;
  let bucketCreated = false;
  let workerAttempted = false;
  let primaryFailure;
  try {
    bucketAttempted = true;
    const created = await api(`${account}/r2/buckets`, {
      method: 'POST', body: { name },
    });
    if (!created.success) throw new Error('Hosted bucket creation failed');
    bucketCreated = true;
    const metadata = {
      main_module: artifact.mainModule,
      compatibility_date: artifact.compatibilityDate,
      bindings: [
        { name: 'SCRATCH', type: 'r2_bucket', bucket_name: name },
        { name: 'QUALIFICATION_TOKEN', type: 'secret_text', text: token },
        { name: 'QUALIFICATION_OWNER', type: 'plain_text', text: nonce },
        { name: 'QUALIFICATION_EXPIRES_AT', type: 'plain_text', text: String(Date.now() + 3600000) },
      ],
    };
    const body = new FormData();
    body.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    for (const module of artifact.modules) {
      const type = { ESModule: 'application/javascript+module', CompiledWasm: 'application/wasm', Data: 'application/octet-stream' }[module.type];
      body.set(module.name, new Blob([module.contents], { type }), module.name);
    }
    workerAttempted = true;
    const uploaded = await api(worker, { method: 'PUT', body });
    if (!uploaded.success) throw new Error('Hosted worker upload failed');
    const enabled = await api(`${worker}/subdomain`, {
      method: 'POST', body: { enabled: true, previews_enabled: false },
    });
    if (!enabled.success) throw new Error('Hosted worker endpoint enablement failed');
    receipt.qualification = await qualify({ url, token });
  } catch (error) {
    primaryFailure = error;
  }
  try {
    if (workerAttempted) {
      const settings = await api(`${worker}/settings`);
      if (settings.status === 404) {
        if (!bucketCreated) throw new Error('Hosted bucket ownership unverified');
      } else {
        const owner = settings.result?.bindings?.find(binding => binding.name === 'QUALIFICATION_OWNER');
        if (!settings.success || owner?.type !== 'plain_text' || owner.text !== nonce) {
          throw new Error('Hosted worker ownership changed or unverifiable; resources preserved');
        }
        const drained = await clean({ url, token });
        if (drained?.empty !== true) throw new Error('Hosted bucket cleanup did not verify emptiness');
        const current = await api(`${worker}/settings`);
        const currentOwner = current.result?.bindings?.find(binding => binding.name === 'QUALIFICATION_OWNER');
        if (!current.success || currentOwner?.type !== 'plain_text' || currentOwner.text !== nonce) {
          throw new Error('Hosted worker ownership changed during cleanup; resources preserved');
        }
        const removed = await api(worker, { method: 'DELETE' });
        if (!removed.success) throw new Error('Hosted worker deletion failed');
      }
    }
    if (bucketCreated) {
      const removed = await api(bucket, { method: 'DELETE' });
      if (!removed.success) throw new Error('Hosted bucket deletion failed');
    } else if (bucketAttempted) {
      const existing = await api(bucket);
      if (existing.status !== 404) throw new Error('Hosted bucket creation outcome uncertain; resource preserved');
    }
    receipt.cleanupComplete = true;
  } catch (cleanupFailure) {
    if (primaryFailure) {
      throw new AggregateError([primaryFailure, cleanupFailure], 'Hosted qualification and cleanup failed');
    }
    throw cleanupFailure;
  }
  if (primaryFailure) {
    if (primaryFailure instanceof Error) {
      Object.defineProperty(primaryFailure, 'cleanupComplete', { value: receipt.cleanupComplete });
    }
    throw primaryFailure;
  }
  return receipt;
}
