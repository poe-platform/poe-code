import assert from "node:assert/strict";
import path from "node:path";
import { inside } from "./admission.mjs";

export const moduleUrl = import.meta.url;
export class OwnedStorage {
  constructor(port, root) { this.port = port; this.root = root; this.directories = []; this.files = []; this.bytes = 0; }
  acquire(filename) {
    assert.ok(filename === this.root || inside(this.root, filename));
    const record = { path: filename, planned: true, acquired: false, identity: null, removed: false };
    this.directories.push(record);
    this.port.mkdir(filename);
    record.acquired = true;
    const stat = this.port.stat(filename);
    assert.equal(stat.kind, "directory"); record.identity = stat.identity;
    return record;
  }
  verify(record) {
    assert.ok(record.acquired && record.identity !== null, `unbound directory: ${record.path}`);
    const stat = this.port.stat(record.path);
    assert.equal(stat.kind, "directory"); assert.equal(stat.identity, record.identity, `directory replaced: ${record.path}`);
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
    const record = { path: filename, planned: true, written: false };
    this.files.push(record); this.bytes += bytes.length;
    this.port.writeExclusive(filename, bytes); record.written = true;
  }
  cleanupFixture() {
    const errors = [];
    for (const record of this.directories.slice().reverse()) {
      try {
        this.verify(record);
        if (record.path === this.root || record.path === path.join(this.root, "records")) continue;
        assert.deepEqual(this.port.list(record.path), [], `unexpected fixture entries: ${record.path}`);
        this.port.rmdir(record.path); record.removed = true;
      } catch (error) { errors.push({ path: record.path, message: error.message }); }
    }
    return errors;
  }
  audit() {
    for (const record of this.directories.filter(item => !item.removed)) {
      this.verify(record);
      const children = [...this.directories.filter(item => item.acquired && !item.removed && path.dirname(item.path) === record.path).map(item => path.basename(item.path)), ...this.files.filter(item => item.written && path.dirname(item.path) === record.path).map(item => path.basename(item.path))].sort();
      assert.deepEqual(this.port.list(record.path).sort(), children, `new owned entries: ${record.path}`);
    }
  }
}
