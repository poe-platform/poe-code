# Explicit locator fix and two harmless loader observations

2026-08-29. Source/preseal commit
`4c764d70148d7c3aacbc743fff7fc09fb4436924`. Preseal SHA256
`1424fa6bd60b13f7455c11e86a0feca3898090bd3822ef73dff20bc8a1e4e801`
(2,854 bytes). Original24971010/b8e4e24b locator STOP and producer
f89cfd7a/0cd47070 remain immutable. Source3adc/309 is unchanged.

## Exact repair and DATA controls

`descriptor.mjs` constructs explicit sourcePath/relativePath/type/bytes/sha256
fields. No manifest spread can overwrite sourcePath. RelativePath must equal
the specifically expected member; injected sourcePath and relative identities
are rejected. Runtime package admission uses readDescriptor on the absolute
identity, not display metadata or cwd fallback. The previously unused compiler
entry descriptor is corrected and authenticated too.

Package identity remains `/tmp/safe-bash-coherent-stage-a-20260829-r1/tools/typescript/package.json`,
3,620 bytes, SHA256 `822ef7ca6452205657b6288b066481ecf508bfbf43455d715cf7d3ec457561e6`.
The unchanged267-byte compiler shim SHA is
`2cffde0b8c6760dfb0b5b0382bbb7e00ba6a8b2d981b9205b256a700a481d983`;
it was admitted as DATA, never imported or run.

Five fresh DATA controls passed: exact bytes; foreign relative member refusal;
sourcePath injection refusal; nonabsolute identity refusal; wrong size before
open. The latter's onOpen counter remains0, versus1 for the positive. These
are not semantic/compiler outcomes or reruns of earlier DATA cohorts.

## Exactly two actual harmless fixture observations

Same authored main40 bytes SHA
`9dd5b814df959368c401fb5b5382314eddc3dcdc612017be3266becbf4676c05`
and local payload420 bytes SHA
`92fac4ccd3232f185b23dcb20ef363c019aeaa71678e36d27eb9cc8974065319`.
Both are byte-identical to the original proposal. Exact TypeScript package.json
was copied without alteration; no new package scope/type boundary was invented.

| ID | Bound path profile | Actual observation |
| --- | --- | --- |
| L01 | Alias `/tmp/...-r2` for entry and permissions | exit1/close1; stdout0; FileSystemRead `/tmp`; no entry receipt |
| L02 | Same inode via `/private/tmp/...-r2` consistently | exit0/close0; one417-byte nonce/hash/main/cwd readiness receipt; stderr0 |

L01's646-byte stderr SHA
`e38ccfcf39da649342eddd082b24c14e3d8187d1a77dfe2171e267bb17330def`
is identical to the original Stage A loader denial. It is an expected refusal,
not a successful compiler or entry. L02's output SHA is
`03878cc99aa1c44ba2f790ae2fef43f67229f756c2e9514be709319ae8dcb08f`.
Dispatch receipts were written after exact input admission and BEFORE spawning.
Both case postguards passed. PID18357 and18358 had exit+close, no signal, and
observed owned-group absence. No TERM/KILL or rescue was required. No universal
process-tree/kernel-drain guarantee is inferred. Probe time10:02:55.847Z–
10:02:56.058Z; total raw fixture capture1,063 bytes.

## Source-qualified diagnosis and scope

The accepted pinned Node22.22.2 fs.js:2815 source identifies the original denied
operation as a stat of the `/tmp` symlink component during main realpath, before
the compiler loads. These two cases now corroborate that route distinction for
the fixed CJS main/relative-payload/package-boundary topology. They do not prove
TypeScript compile-cache/dependencies, npm, every package lookup or real producer
completion. The installed Node binary remains the exact pinned22.22.2 identity.

No product/source309/tool2274/link12 edits occurred. Prior complete source/tool
postguard evidence remains separately bound; this run freshly admits Node and
the exact package/shim plus fixture files, not a new whole2274 replay claim.
Retained harmless capsule: `/private/tmp/safe-bash-stage-a-loader-20260829-r2`.
Zero TypeScript/compiler/npm/pack/product/engine/Workers/oracle execution.

## Ready command delta for a FUTURE producer preseal

No shipping producer file was changed. A future authorized successor should
create a NEW owned root, verify alias/physical paths identify the same dev/inode,
then use its canonical physical root `P` for EVERY executable source path,
cwd, HOME, TMPDIR, empty PATH directory, npm configuration/cache/pack paths,
read/write permission root and receipt/postguard location. Keep pinned Node `N`
unchanged. No `/tmp`, `/private`, ancestor-recursive allowance or symlink flags.

Strict build, cwd `P/source`:

```text
N --experimental-permission --allow-fs-read=P --allow-fs-read=N --allow-fs-write=P P/tools/typescript/lib/tsc.js -p tsconfig.build.json
```

Offline pack, same cwd and finite sanitized environment:

```text
N --experimental-permission --allow-fs-read=P --allow-fs-read=N --allow-fs-write=P P/tools/npm/bin/npm-cli.js pack --json --offline --ignore-scripts --pack-destination P/pack --cache P/cache
```

Rebind exact source/tool copies, absent lifecycle hooks, complete producer
supervisor, bounds and receipt-before-inflate protocol in that NEW preseal.
These commands were NOT run here. Further permission surprises remain possible
and must stop rather than trigger broad allowances. Real producer and Stage B
both still require fresh ROOT authorization. PUBLIC95 closure is not needed or
consumed by this loader proof. All historical STOPs remain unrescored.
