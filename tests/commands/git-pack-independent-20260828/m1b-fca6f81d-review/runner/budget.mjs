import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { demand, writeExclusive, sha256 } from './primitives.mjs';

export class Budget {
  constructor(root, caps, origin = performance.now()) {
    this.origin = origin;
    this.end = this.origin + caps.wallMs;
    this.root = root;
    this.caps = caps;
    this.capture = 0;
    this.work = 0;
    this.starts = 0;
    this.active = new Map();
    this.peak = 1;
    this.failures = [];
    this.unsafe = null;
    this.sequence = 0;
  }
  now() { return performance.now(); }
  elapsed() { return this.now() - this.origin; }
  deadline(offsetMs) { return Math.min(this.end, this.origin + offsetMs); }
  admit(deadline) {
    demand(this.unsafe === null && this.now() < Math.min(deadline, this.end - this.caps.finalizeMs), 'ADMISSION_CLOSED');
  }
  reserveWork(bytes) {
    demand(Number.isSafeInteger(bytes) && bytes >= 0 && this.work + bytes <= this.caps.workBytes, 'WORK_RESERVATION');
    this.work += bytes;
  }
  releaseDeletedWork(bytes) {
    demand(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= this.work, 'WORK_RELEASE');
    this.work -= bytes;
  }
  reserveCapture(bytes, final = false) {
    const limit = this.caps.captureBytes - (final ? 0 : this.caps.terminalBytes);
    demand(Number.isSafeInteger(bytes) && bytes >= 0 && this.capture + bytes <= limit, 'CAPTURE_RESERVATION');
    this.reserveWork(bytes);
    this.capture += bytes;
  }
  fail(label, unsafe = false) {
    if (this.failures.length < 4096) this.failures.push(String(label).slice(0, 4096));
    else this.unsafe = 'FAILURE_METADATA_OVERFLOW';
    if (unsafe) this.unsafe ??= String(label).slice(0, 4096);
  }
  async raw(label, bytes, final = false) {
    demand(/^[A-Za-z0-9_.-]{1,160}$/.test(label), 'CAPTURE_LABEL');
    this.reserveCapture(bytes.length, final);
    const relative = `raw/${String(++this.sequence).padStart(6, '0')}-${label}`;
    await writeExclusive(path.join(this.root, relative), bytes);
    return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
  }
  async record(label, value, final = false) {
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    demand(bytes.length <= 1048576, 'METADATA_LIMIT');
    return this.raw(`${label}.json`, bytes, final);
  }
  async finalFileTotal() {
    let bytes = 0;
    let files = 0;
    const visit = async directory => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        const stat = await fs.lstat(filename);
        demand(!stat.isSymbolicLink(), 'FINAL_WORK_SYMLINK');
        if (stat.isDirectory()) await visit(filename);
        else { demand(stat.isFile(), 'FINAL_WORK_KIND'); bytes += stat.size; files++; }
      }
    };
    await visit(this.root);
    demand(bytes <= this.caps.workBytes && files <= 20000, 'FINAL_WORK_LIMIT');
    return { bytes, files, captureCharged: this.capture, workReserved: this.work };
  }
}
