import assert from 'node:assert/strict';
import { fixtureFs as originalFs } from '../safety-v1/vfs.mjs';

export function fixtureFs(entry, FsError, trace) {
  const fs = originalFs(entry, FsError, trace);
  const readdir = fs.readdir;
  trace.listings = [];
  fs.readdir = async (path, options) => {
    const listing = await readdir(path, options);
    assert.equal(path, '/root');
    assert.equal(trace.listings.length, 0);
    const observation = { path, next: 0, yielded: 0, done: false, returned: 0, names: [] };
    trace.listings.push(observation);
    let acquired = false;
    const nativeIterator = listing[Symbol.iterator].bind(listing);
    Object.defineProperty(listing, Symbol.iterator, { value() {
      assert.equal(acquired, false, 'one listing traversal');
      acquired = true;
      const iterator = nativeIterator();
      return {
        [Symbol.iterator]() { return this; },
        next() {
          assert(++observation.next <= 65, 'bounded listing trace');
          const result = iterator.next();
          if (result.done) observation.done = true;
          else { observation.yielded++; observation.names.push(result.value.name); }
          return result;
        },
        return() {
          assert.equal(++observation.returned, 1);
          return { done: true, value: undefined };
        },
      };
    } });
    return listing;
  };
  return fs;
}
