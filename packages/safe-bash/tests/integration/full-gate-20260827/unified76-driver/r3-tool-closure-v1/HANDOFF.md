# Five missing native helper bindings — preparation only

2026-08-28. Recipe/inspection commit **adcb1467caad7165361f035f110b40dd1bbdf07d**.
No new runtime/native admission, target execution or full-gate authorization.

## Exact observed targets

All are installed regular0755 files, canonical physical paths equal origin,
with no symlink component in the observed tool path. Both contained Mach-O
slices are recorded; no code was loaded/executed. Utility version output was
not queried. Profile: macOS26.4.1/build25E253 metadata plus these exact bytes.

| Role | Origin/physical | Bytes | SHA256 |
|---|---|---:|---|
| cut | /usr/bin/cut |102480|f2199a84b3bcad698217c78448615f296ee30d2b8dca713036cf8cdce3b783da|
| sort | /usr/bin/sort |206032|e1cae8c9638af1466950fd7c241434c81242d4bbc54fff5f2d18e0e86ea9c7e3|
| tee | /usr/bin/tee |101232|97832f8519ebacf737782b40cf0a33dc5b27bd4bfe7493e952c6c65ef309bea0|
| xargs | /usr/bin/xargs |135984|aebe3d43c7bfa8df51a2c14a0f3718e24f08e68698cb2fd89ffdb980c4ab3213|
| cat | /bin/cat |118992|580599dd318fa34bb0f91c29106894852c49c3a3df724b637113df95c6758fe6|

`CALLS.json` binds exact five G08 IDs54560/54588/54616/54644/54680, scripts,
arguments, literal file inputs, caller environment overrides, native3s/16MiB
bounds, owned cwd and unchanged cleanup/assertions. Source blobs:
`harness.ts` f3d35ec0 and `pipelines.test.ts` 6b949c63 equal fixedf5.
These use `/bin/bash -c` with bare utility names and do not request GNU variants.
Do not substitute GNU/Homebrew tools or infer a prior successful PATH resolution.
The xargs role is exactly `-0 cat`; cat's space-bearing path operands come from
rg's NUL-delimited output. Derived operand names are not actual child telemetry.

## Concrete qualification still needed

All five executables have observed load commands for **/usr/lib/dyld** and
**/usr/lib/libSystem.B.dylib**. The loader is readable2357376bytes,0755,
SHA a572fe3d9d46fc2c6461745a13940ec63de8c9ab333fcba5ef1e112783e521a7;
its parsed slices contain no recognized dylib/loader/rpath/environment references.
That is static metadata, not proof of all runtime images, system cache contents,
indirect loads, helper execution or vendor signatures.

libSystem is **ENOENT**. Before future admission, ROOT must decide the exact
five new (tool path, /usr/lib/libSystem.B.dylib) OS-metadata pairs enumerated in
SUCCESSOR-PROFILE. No prior Node/Git/inspector exception automatically covers
them. Host plist SHA7cd74d8a730f38923ef39aed140d3172b3886e64b55f7489f33cef3731687709
is metadata only, never a missing library hash/full OS attestation. An unknown
runtime image remains unqualified, not silently eligible.

## Explicit successor-only delta

`SUCCESSOR-PROFILE.json` raw SHA
**71ba31dea9594c3eee23c054a40b0fa09de4a78eb129a44018103c21a5dfb36c**
contains exactly five proposed alias additions to the previous18 (prospective23),
exact file/link/role bindings, readable loader data and pending five OS pairs.
All existing aliases are unchanged; existing51 declared native assets contain
no name collision with these five. This is manifest comparison, not a fresh
native-root census or49+2 admission run. No PATH directory, arbitrary xargs
command, executable permission, selector route or library-prefix allowance added.

The proposal is deliberately **not runnable/admitted** and has no successor Git
candidate SHA. No shipping launcher/profile/candidate file was edited. Exact
implementation/admission guards and OS decisions must be reviewed before a new
driver is selected. No silent current-HEAD assembly or inherited GO.

`CHANGESET.json` binds previous source43777899's15 files (13 fixture/helper
blobs plus execute/DRIVER), evidence2ae74702 and these new proposed tools.
The prospective product candidate remains **f5 + only those13 fixture/helper
blobs**; product src/package/build inputs remain unchanged. Expected packc109
is derived from unchanged inputs, not newly built. Source437's45 synthetic
controls are retained separate evidence, not repeated or converted to native proof.
Future assembly must refresh exact closure/profile/cleanup/source bindings;
old f5 manifests and all historical attempts stay immutable.

## Actual bounded work and review request

- Metadata collector:18 reads,3803877 bytes, five tools plus readable loader,
  host metadata, two local SDK layout headers and explicit source/evidence inputs.
- Native versions/oracles/inspectors/tests/compiler/product/private/setup/gate:0.
  No installs/downloads, subject process spawn, fence change or old-root cleanup.
- Twenty future data/admission controls and five original script replays are
  **proposed/unexecuted**, in FUTURE-CONTROLS.md. They require separate authority.
- Preliminary metadata console query encountered a missing optional `staging`
  property (TypeError after printing keys). This was not an admission/tool/test
  failure or execution; the sealed reader uses actual schemas and completed.
  The initial broad search emitted excessive historical-text output; subsequent
  inspection was restricted to the exact fixture/manifests. No data was modified.
- Dirac should review exact source roles, path/byte binding, parser bounds and
  absent-library qualification, then proposed guard/child-route controls. Static
  preparation is not independent successful native dispatch or complete closure.

R3 remains **19425P/132F/7skip,6/14**, integrity/cleanup unqualified. Structural
signal, directory mode, socket, env-S expectations and all skips are untouched.
All old consumed authorizations remain consumed. No another attempt is authorized.
