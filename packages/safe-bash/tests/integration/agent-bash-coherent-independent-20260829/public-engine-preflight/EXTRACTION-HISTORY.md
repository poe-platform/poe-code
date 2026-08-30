# DATA extraction version history

Original extractor SHA256:
`221fe3904c9815a867f7f8340fd7726acf2ae5702f63646a9f44591ed84e867b`.
Its stdout/stderr and exit1 are retained as extract-bindings.stdout/stderr.
It authenticated archive bytes and each proof object, then incorrectly treated
archive `files[].path` as monorepo-root-relative. Root package.json is blob
bcb9f29f4325f23ad1e597758475ab2d5dd86a12, not the engine package blob
94e9526e903010bb6458aee4c4863f0b2bfa1afa. Bounded traversal of those same proof
trees locates the latter exactly at packages/safejs/package.json.

V2 changes exactly one substring in extract-bindings.mjs:
`const components=file.path.split('/')` becomes
`const components=('packages/safejs/'+file.path).split('/')`.
Reversing that unique substitution reproduces the original source hash above.
No expected hash, archive bytes, proof object or assertion is weakened. This
is a captured retired DATA namespace-assumption failure, not demonstrated
source corruption. All98 paths must now pass the actual package-domain proof.
The original result is not rescored; v2 gets separately named outer captures.

An earlier selected-field presentation helper also raised `Cannot read
properties of undefined (reading 'slice')` on an empty diagnostics array. Its
tool-returned error remains the only capture; no OS child/target was started.
The replacement presentation explicitly handles empty arrays. No compiler or
engine outcome follows from either helper correction.
