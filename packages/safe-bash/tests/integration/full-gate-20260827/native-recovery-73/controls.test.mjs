import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { acceptedSha256, copyAcceptedAsset } from './recover.mjs';

const accepted = '/tmp/safe-bash-search-sidecar-review-tnXxyl/native-bin/rg';
const changed = '/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex-path/rg';
for (const mode of ['exact-copy', 'missing', 'wrong-bytes', 'changed-same-version', 'symlink-source', 'existing-destination', 'symlink-destination']) test(mode, context => {
  const temporary = mkdtempSync(join(tmpdir(), 'native-recovery-control-'));
  context.after(() => rmSync(temporary, { recursive: true, force: true }));
  const destination = join(temporary, 'result');
  let source = accepted;
  if (mode === 'missing') source = join(temporary, 'missing');
  if (mode === 'wrong-bytes') { source = join(temporary, 'wrong'); writeFileSync(source, 'not accepted'); }
  if (mode === 'changed-same-version') source = changed;
  if (mode === 'symlink-source') { source = join(temporary, 'link'); symlinkSync(accepted, source); }
  if (mode === 'existing-destination') writeFileSync(destination, 'preserve');
  if (mode === 'symlink-destination') symlinkSync(accepted, destination);
  if (mode === 'exact-copy') assert.equal(copyAcceptedAsset(source, destination).sha256, acceptedSha256);
  else assert.throws(() => copyAcceptedAsset(source, destination));
  if (mode === 'existing-destination') assert.equal(readFileSync(destination, 'utf8'), 'preserve');
  assert.equal(createHash('sha256').update(readFileSync(accepted)).digest('hex'), acceptedSha256);
});
