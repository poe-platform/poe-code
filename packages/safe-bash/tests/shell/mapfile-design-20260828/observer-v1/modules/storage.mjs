import assert from "node:assert/strict";
import path from "node:path";
import { digest, inside, statData } from "./admission.mjs";
import { assertOwnData, describeReason, snapshotOwnData } from "./data.mjs";

export const moduleUrl = import.meta.url;
export class OwnedStorage {
  constructor(port, root) { this.port = port; this.root = root; this.directories = []; this.files = []; this.bytes = 0; }
  acquire(filename) {
    assert.ok(filename === this.root || inside(this.root, filename));
    const record = { path: filename, planned: true, acquired: false, identity: null, removed: false };
    this.directories.push(record);
    this.port.mkdir(filename);
    record.acquired = true;
    const stat = statData(this.port, filename);
    assert.equal(stat.kind, "directory"); record.identity = stat.identity;
    assert.equal(stat.mode, 0o700, "owned directory mode");
    return record;
  }
  verify(record) {
    assert.ok(record.acquired && record.identity !== null, `unbound directory: ${record.path}`);
    const stat = statData(this.port, record.path);
    assert.equal(stat.kind, "directory"); assert.equal(stat.identity, record.identity, `directory replaced: ${record.path}`);
    assert.equal(stat.mode, 0o700, "owned directory mode");
  }
  write(name, value) {
    assert.match(name, /^(attempt-(?:N|A)\d{2}|spawn-(?:N|A)\d{2}|row-(?:N|A)\d{2}|final)\.json$/u);
    const directory = this.directories.find(item => item.path === path.join(this.root, "records"));
    this.verify(directory);
    const filename = path.join(directory.path, name);
    assert.ok(inside(directory.path, filename));
    const bytes = Buffer.from(JSON.stringify(value));
    assert.ok(bytes.length <= 4 * 1024 * 1024 - this.bytes, "receipt byte ceiling");
    assert.ok(this.files.length < 132, "receipt entry ceiling");
    const record = { path: filename, planned: true, written: false, bytes: bytes.length, sha256: digest(bytes) };
    this.files.push(record); this.bytes += bytes.length;
    this.port.writeExclusive(filename, bytes); record.written = true;
  }
  cleanupFixture() {
    const errors = [];
    for (const record of this.directories.slice().reverse()) {
      try {
        this.verify(record);
        if (record.path === this.root || record.path === path.join(this.root, "records")) continue;
        assertOwnData(this.port.list(record.path), [], `unexpected fixture entries: ${record.path}`);
        this.port.rmdir(record.path); record.removed = true;
      } catch (reason) { const error = { path: record.path, message: describeReason(reason) }; Object.defineProperty(error, "reason", { value: reason }); errors.push(error); }
    }
    return errors;
  }
  audit() {
    for (const record of this.files.filter(item => item.written)) {
      assert.equal(this.port.canonical(record.path), record.path, "canonical receipt path");
      const stat = statData(this.port, record.path);
      assert.equal(stat.kind, "file"); assert.equal(stat.bytes, record.bytes, "receipt byte count");
      assert.equal(stat.mode, 0o600, "owned receipt mode");
      assert.equal(digest(this.port.read(record.path)), record.sha256, "receipt bytes");
    }
    for (const record of this.directories.filter(item => !item.removed)) {
      this.verify(record);
      const children = [...this.directories.filter(item => item.acquired && !item.removed && path.dirname(item.path) === record.path).map(item => path.basename(item.path)), ...this.files.filter(item => item.written && path.dirname(item.path) === record.path).map(item => path.basename(item.path))].sort();
      assertOwnData(snapshotOwnData(this.port.list(record.path)).sort(), children, `new owned entries: ${record.path}`);
    }
  }
}
