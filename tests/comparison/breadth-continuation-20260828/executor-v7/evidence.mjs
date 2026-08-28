import fs from 'node:fs';
import path from 'node:path';
import { hash, requireThat } from '../executor-v4/safety.mjs';

export function createEvidenceBudget(runRoot, { limit = 268435456, lockPath = null } = {}) {
  requireThat(Number.isSafeInteger(limit) && limit > 0 && limit <= 268435456, 'EVIDENCE_LIMIT', limit);
  const records = new Map();
  const stage = new Map();
  let attempted = 0;
  let stageBytes = 0;
  const within = filename => {
    const absolute = path.resolve(filename);
    requireThat(absolute.startsWith(`${runRoot}/`) || absolute === lockPath, 'EVIDENCE_PATH', absolute);
    requireThat(!absolute.split(path.sep).some(name => name.toLowerCase() === 'agents.md'), 'EVIDENCE_INSTRUCTION', absolute);
    return absolute;
  };
  function reserve(filename, bytes, mode, sha256, kind = 'record') {
    const absolute = within(filename);
    requireThat(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 262144 && !records.has(absolute), 'EVIDENCE_RESERVATION', absolute);
    requireThat(attempted + bytes <= limit, 'EVIDENCE_CAP', attempted + bytes);
    attempted += bytes;
    const entry = { path: absolute, bytes, mode, sha256, kind, complete: false };
    records.set(absolute, entry);
    return entry;
  }
  function finish(filename) {
    const entry = records.get(path.resolve(filename));
    requireThat(entry, 'EVIDENCE_UNRESERVED', filename);
    const info = fs.lstatSync(entry.path);
    requireThat(info.isFile() && !info.isSymbolicLink() && info.size === entry.bytes && (info.mode & 0o7777) === entry.mode, 'EVIDENCE_METADATA', entry.path);
    requireThat(hash(fs.readFileSync(entry.path)) === entry.sha256, 'EVIDENCE_HASH', entry.path);
    entry.complete = true;
  }
  function declareStage(base, files) {
    for (const entry of files) {
      const absolute = within(path.join(base, entry.path));
      requireThat(!stage.has(absolute) && !records.has(absolute), 'STAGE_DUPLICATE', absolute);
      stage.set(absolute, { ...entry, path: absolute });
      stageBytes += entry.bytes;
    }
  }
  function audit({ partial = false } = {}) {
    const expected = new Map([...records, ...stage]);
    const directories = new Set();
    for (const filename of expected.keys()) {
      if (!filename.startsWith(`${runRoot}/`)) continue;
      let parent = path.dirname(filename);
      while (parent !== runRoot) { directories.add(parent); parent = path.dirname(parent); }
    }
    let files = 0;
    let observedEvidence = 0;
    let observedStage = 0;
    let entries = 0;
    const visit = directory => {
      for (const name of fs.readdirSync(directory)) {
        const filename = path.join(directory, name);
        requireThat(++entries <= expected.size + directories.size, 'EVIDENCE_ENTRY_CAP', entries);
        const info = fs.lstatSync(filename);
        requireThat(!info.isSymbolicLink(), 'EVIDENCE_SYMLINK', filename);
        if (info.isDirectory()) { requireThat(directories.has(filename), 'EVIDENCE_UNLISTED_DIRECTORY', filename); visit(filename); continue; }
        const entry = expected.get(filename);
        requireThat(entry && info.isFile(), 'EVIDENCE_UNLISTED', filename);
        requireThat(info.size <= entry.bytes && (info.mode & 0o7777) === entry.mode, 'EVIDENCE_OBSERVED_SIZE_MODE', filename);
        if (!partial || entry.complete || stage.has(filename)) requireThat(info.size === entry.bytes && hash(fs.readFileSync(filename)) === entry.sha256, 'EVIDENCE_CONTENT', filename);
        if (stage.has(filename)) observedStage += info.size;
        else observedEvidence += info.size;
        files++;
      }
    };
    if (fs.existsSync(runRoot)) visit(runRoot);
    for (const entry of records.values()) if (entry.complete) requireThat(fs.existsSync(entry.path), 'EVIDENCE_REMOVED', entry.path);
    if (lockPath && fs.existsSync(lockPath)) { const entry = records.get(lockPath); requireThat(entry, 'LOCK_UNRESERVED', lockPath); finish(lockPath); observedEvidence += entry.bytes; }
    requireThat(observedEvidence <= attempted && attempted <= limit && observedStage <= stageBytes, 'EVIDENCE_AGGREGATE', { observedEvidence, attempted, observedStage, stageBytes });
    return { files, entries, observedEvidence, attemptedEvidence: attempted, limit, observedStage, declaredStageBytes: stageBytes, partial, wholeCheckoutClaim: false };
  }
  return {
    reserve, finish, declareStage, audit,
    stageAlias(base, files) { for (const entry of files) { const absolute = within(path.join(base, entry.path)); requireThat(!stage.has(absolute) && !records.has(absolute), 'STAGE_DUPLICATE', absolute); stage.set(absolute, { ...entry, path: absolute }); } },
    charge(root, name, bytes) { return reserve(path.join(root, name), bytes.length, 0o644, hash(bytes)); },
    external(filename, bytes, mode = 0o444, kind = 'operation-claim') { return { ...reserve(filename, bytes.length, mode, hash(bytes), kind) }; },
    snapshot() { return { attemptedEvidence: attempted, limit, records: records.size, declaredStageFiles: stage.size, declaredStageBytes: stageBytes }; },
  };
}

export function writeReserved(permit, bytes) {
  requireThat(permit && typeof permit.path === 'string' && Number.isSafeInteger(permit.bytes) && permit.bytes <= 262144 && bytes.length === permit.bytes && hash(bytes) === permit.sha256, 'EXTERNAL_WRITE_PERMIT', permit?.path);
  fs.writeFileSync(permit.path, bytes, { flag: 'wx', mode: permit.mode });
}

export function claimBytes(operation, recipe) { return Buffer.from(`${JSON.stringify({ operation, recipe })}\n`); }
export function writeClaim(config, operation, recipe, outputRoot) {
  const permit = config.claimPermit;
  requireThat(permit?.path === path.join(outputRoot, `operation-${operation.id}.claim`) && permit.mode === 0o444 && permit.kind === 'operation-claim', 'CLAIM_PATH', permit?.path);
  writeReserved(permit, claimBytes(operation, recipe));
}
