# Minimal ROOT freeze interface

No candidate SHA/pack has been supplied. No fields below are populated by guessing
HEAD, package names/counts, private runtimes or current node_modules. No twelve-
document prerequisite or signing infrastructure is required. Existing accepted
receipts can supply these few byte bindings; ROOT's externally delivered receipt
hash is the coordination authority. The sibling preparation gate remains unchanged.

## One binding JSON plus one ROOT receipt

`schema`: `safe-bash.execution-binding.v1`.
`preparationCommit`: `2b2a5fe48142dd94238d37ec77dfd736e2117e71`.
`seals`: exact `SEAL.json` and `AMENDMENT_V2_SEAL.json` SHA256 map exported by
cohorts.mjs. `profiles`: exactly `["original","aligned","breadth"]`.

An **artifact** is `{root:absoluteDirectory,path:relativeOrContainedAbsolute,
bytes:integer,sha256:64hex}`. File identity is checked with bounded reads,
no-follow regular opens, owned chunk copies and before/after identity checks.
Explicit /tmp root spelling is canonicalized; symlinks below a selected root,
traversal, aliases and escapes are rejected. Reader limits are not guest limits.

`candidate` supplies:

- `commit`:40hex ROOT-approved integration commit including accepted fixes.
- `gitTree`: exact Git tree identity (40hex or64hex).
- `sourceSha256` and `source`: matching SHA256/artifact of the approved source
  archive or inventory bytes. This byte identity is not a new source/test audit.
- `packSha256` and `pack`: matching SHA256/artifact of the accepted public package
  archive. ROOT's accepted packed review must bind its unpacked closure below to
  these archive bytes; the bridge does not install/re-extract or manufacture that
  prior packed-review proof. Candidate qualification is ROOT-owned, not inferred
  from a hash reader or a version string.

`node`: approved executable artifact. `runner`: `{root:absoluteExecutionDirectory,
files:[{path:relative,bytes,sha256}]}` binding every runtime file listed in
binding.mjs. Author-only test/evidence files need not be admitted engine modules.
The runtime's exact required list is documented by `requiredRunner` in that file.
All admitted helper dependencies must be listed; no ambient code fallback.

`engines`: exactly keys `virtual-bash` and `just-bash`, each containing:

```json
{
  "closure": {"root":"ABSOLUTE_APPROVED_FROZEN_ROOT","files":[]},
  "packageJson":"RELATIVE_PUBLIC_PACKAGE/package.json",
  "entry":"RELATIVE_RESOLVED_PUBLIC_ESM_ENTRY",
  "assets":["RELATIVE_EXPLICIT_WORKER_OR_WASM_ASSET"],
  "locks":["RELATIVE_APPROVED_LOCK"],
  "heapMiB":256
}
```

The empty files array is intentionally not executable. Supply each exact relative
regular member, byte length and SHA256. Before/after exact closure membership is
checked only for these selected roots, not broad live dependency directories.
Limits:8192 files,1GiB aggregate,256MiB/file, depth32. Assets may be empty for a
zero-runtime-dependency candidate; baseline needs its provided runtime assets and
installed dependencies for the unchanged optional recipes. Locks are nonempty.
`heapMiB` is ROOT's explicit breadth policy, not a fabricated symmetric RSS limit;
expanded retains256MiB. Package names/exports, actual resolution and entry hashes
are checked, not inferred from the proposed entry path.

For baseline select authenticated retained just-bash3.4.2 public package bytes
and the declared frozen dependency closure, including the provided11 worker/WASM/
data and18 dependency-entry references. Retained published-auth evidence lives at
commit010411eff3dd210b9575e061914efccd65c13547 under
benchmarks/reports/comparison-fairness-20260827/published-artifact-authentication/.
Its3844-entry post-run closure is distinct from the3842-only earlier profile.
`baselineTar` is the retained archive artifact with SHA256
f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d.
The root public import must resolve to authenticated entry SHA256
70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c.
Other dependency hashes establish frozen bytes, not publisher authentication or
optional runtime usability. No500MB re-authentication loop is run without inputs.

`host`: `{root:absoluteOwnedScratchRoot,cwd:absoluteContainedDirectory,env:{...}}`.
Explicit allowlisted keys only:PATH,HOME,TMPDIR,LANG,LC_ALL,TZ and optional USER.
Required values LANG=C,LC_ALL=C,TZ=UTC; HOME/TMPDIR/cwd must be existing directories
under host.root. No inherited NODE_OPTIONS/NODE_PATH, proxy/cloud credentials,
dynamic-loader environment or private package resolution. Guest env is separately
sealed and is never populated from this host env.

ROOT receipt (<=64KiB):

```json
{
  "authority":"ROOT",
  "purpose":"MEASURE_HISTORICAL",
  "bindingSha256":"EXACT_BINDING_FILE_SHA256",
  "candidateCommit":"EXACT_APPROVED_COMMIT",
  "executionAuthorized":true,
  "timingAuthorized":false,
  "qualificationAccepted":true
}
```

Deliver the receipt's SHA256 separately through ROOT coordination and CLI flag.
`qualificationAccepted` refers to ROOT's existing source/inventory/consumer and
different packed-review acceptance; no new paperwork, keys or artificial signer
is introduced. The receipt must also approve the reviewed runner's hashes and
the documented fixed bounds through the bound file. Current author tests are not
ROOT approval and cannot admit product imports. No new24/native recapture or
tree/file qualification prerequisite is added to these historical measurements.
