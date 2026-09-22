import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

// Dependency updates require a reviewed receipt and rerun of the provider
// interface/bundle contracts. These pins do not qualify cloud execution.
it.each([
  { directory: '../deploy/', sdk: '@cloudflare/sandbox', version: '0.12.9', digest: 'ff26e8e490c6e8304752adb03d50b7a75c0098373f37992c7219aa8b539952b2' },
  { directory: '../../remote-execution/cloudflare/', sdk: '@cloudflare/sandbox', version: '0.12.9', digest: '880338c2d27c14a6dec4d163cebfd14a1276e905358130382d2809b72ff547c9' },
  { directory: '../../remote-execution/modal/', sdk: 'modal', version: '0.10.1', digest: '9de129d23cfad6fda0885a1111a699c9214a82d80fff9bb0d0bfa36b809b1933' },
])('gates $sdk dependency and transitive lock identity drift', async ({ directory, sdk, version, digest }) => {
  const manifest = JSON.parse(await readFile(new URL(directory + 'package.json', import.meta.url), 'utf8'));
  const bytes = await readFile(new URL(directory + 'package-lock.json', import.meta.url));
  const lock = JSON.parse(bytes.toString('utf8'));
  expect(manifest.dependencies[sdk]).toBe(version);
  expect(lock.packages['node_modules/' + sdk].version).toBe(version);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
});
