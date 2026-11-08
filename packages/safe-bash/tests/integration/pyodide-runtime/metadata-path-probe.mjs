// Real-runtime observation, deliberately outside unit-test discovery.
import assert from "node:assert/strict";
import { loadPyodide } from "pyodide";

const pyodide = await loadPyodide();
const fs = pyodide.FS;
fs.writeFile("/probe-metadata", "x");
const node = fs.lookupPath("/probe-metadata").node;
const original = node.node_ops;
node.node_ops = {
  ...original,
  getattr(target) {
    return {
      ...original.getattr(target),
      dev: 2 ** 32 + 7,
      ino: 2 ** 40 + 9,
      uid: 2 ** 32 + 11,
      blksize: 16384,
      blocks: 2 ** 32 + 13,
      mtime: new Date(1234.75),
    };
  },
};
const observed = JSON.parse(pyodide.runPython(`
import os, json
s = os.stat('/probe-metadata')
json.dumps(dict(dev=s.st_dev, ino=s.st_ino, uid=s.st_uid,
    blksize=s.st_blksize, blocks=s.st_blocks, mtime_ns=s.st_mtime_ns))
`));
assert.equal(observed.dev, 7);
assert.equal(observed.ino, 2 ** 40 + 9);
assert.equal(observed.uid, 11);
assert.equal(observed.blksize, 4096);
assert.equal(observed.blocks, 13);
assert.equal(observed.mtime_ns, 1234000000);
const paths = JSON.parse(pyodide.runPython(`
def outcome(path):
    try:
        with open(path) as stream:
            return stream.read()
    except OSError as error:
        return error.errno
json.dumps({p: outcome(p) for p in ['/probe-metadata/', '/probe-metadata/.']})
`));
assert.equal(paths["/probe-metadata/"], "x");
assert.equal(paths["/probe-metadata/."], "x");
console.log(JSON.stringify({ runtime: pyodide.version, node: process.version, observed, paths }));
