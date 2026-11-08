# Gnumeric 1.12.61 reference qualification

Execute this procedure as an agent. Native commands are QA oracles only; they
must never enter the JavaScript product runtime. Task owner: root. Owned paths:
`docs/ssconvert/reference-profile.json`, `docs/specs/ssconvert.md`, this procedure,
and `out/ssconvert-reference-20260919`. Preserve all other files and containers.

1. Download the official Gnumeric 1.12.61 archive into the owned `out` directory.
   Require SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`
   before extraction. Authenticate any supplementary source archives against
   their official checksums. Record archive URLs and hashes in the profile.
2. Use an isolated Linux container through an explicit Docker context. Record
   image digest, architecture, OS, dependency package versions, configure
   arguments, compiler, binary and linked-library hashes. Compile and install
   unchanged upstream sources into an explicit prefix. Keep build logs in `out`.
3. Set and record locale, timezone, HOME and XDG configuration/data/cache roots.
   Use empty invocation-owned configuration roots. Record fonts, paper sizes,
   available solver programs and plugin activation separately from source
   declarations. A manifest or installed library is not activation evidence.
4. Capture argv, exit status and stdout/stderr independently, without trimming,
   for version; every help group and qualified alias; usage; missing operands;
   unknown options; importer, exporter and image listings; parser conflicts;
   duplicate flags; and action precedence. Preserve exact output bytes in the
   reduced profile using a reversible encoding and SHA-256.
5. Probe listed formats with original small fixtures. Label each format as
   listed, exercised, failed or unmeasured; a successful listing does not prove
   conversion support. Probe graph renderability separately from image listings.
6. Parse every source plugin manifest into a coverage register. Record each
   service, source pathname/hash, build condition, installed state and measured
   availability. Include unbuilt and interactive-only services. Additional
   profiles must exercise optional file-format plugins; unavailable dependencies
   remain blockers rather than shrinking the requested scope.
7. Reduce observations into `docs/ssconvert/reference-profile.json` and source
   contracts into `docs/specs/ssconvert.md`, including line citations and unknowns.
   Validate JSON decoding, capture hashes, manifest inventory completeness and
   Markdown formatting with maintained applicable routes. Research work does
   not require product unit tests, builds or CLI screenshots.
8. Stop the owned container and remove only owned scratch after all required
   evidence has been reduced. Record incomplete captures and build failures
   before cleanup. Do not mark `freeze-reference-contract` complete while its
   native/runtime/optional-profile gates remain unmeasured. Do not advance to
   product implementation, commit, push, publish or edit README files.

## Fresh reproduction and remaining gates

The 2026-09-19 requalification used owned scratch
`out/ssconvert-freeze-20260919` and Docker context `colima`, container
`ssconvert-freeze-20260919`. Use the recorded Debian digest, never an unpinned
replacement. Bind only the owned evidence directory at `/evidence`; do not mount
the repository, host HOME, native plugin roots or Docker socket inside the oracle.
Dependency sources may be extracted at container `/out` when the host bind mount
cannot preserve tar permissions. Remove the owned container after reduction.

1. Authenticate Gnumeric, GOffice, GTK and GLib against the retained official
   `.sha256sum` captures before extracting. The mandatory Gnumeric archive hash
   is the task's supplied hash. Download Psiconv directly from its recorded
   author's URL and require the recorded archive hash; a separate publisher
   checksum for that legacy archive was not established.
2. Install the primary profile's requested packages, additionally `python3`,
   `libgda-5.0-dev` and `python3-dev` used by this fresh research environment.
   Check every installed version and archive SHA-256 against
   `requalification.packageArchiveIdentities`. This includes transitive inputs.
   An unavailable exact archive is a reproduction failure, not permission to
   substitute a new version. The package mirror's availability is external state.
3. In the owned extracted GOffice tree, run `./configure
--prefix=/opt/ssconvert-reference --disable-introspection`, then `make -j4`
   and `make install`. In the Gnumeric tree, set
   `PKG_CONFIG_PATH=/opt/ssconvert-reference/lib/pkgconfig` and
   `LD_LIBRARY_PATH=/opt/ssconvert-reference/lib`, run `./configure
--prefix=/opt/ssconvert-reference --disable-introspection --disable-component
--without-python`, then `make -j4` and `make install`. Compile schemas with
   `glib-compile-schemas /opt/ssconvert-reference/share/glib-2.0/schemas`.
   Retain actual compiler/linker flags and require the qualified binary hash.
4. Compile the retained inventory-helper source against installed
   `libspreadsheet-1.12` using the recorded pkg-config flags. Construct the exact
   explicit environment in `requalification.freshRuntime.environment`, including
   fresh initially empty HOME/XDG roots and no display/session inheritance.
   Execute the native argv cases and retain each channel/status independently.
   Reproduce the 152 CLI cases and all 69 systematic qualified-alias probes.
   The encoded ad hoc collectors are acquisition provenance, not a replacement
   for this agent-executed QA procedure or product tests.
5. Reproduce the original CSV export fixture, the explicit importer cases,
   original repeated-set/export-option cases, hidden goal-seek/moving-average
   fixtures, MIME clipboard cases and the captured MPS solver invocation.
   Reproduce graph exports against the authenticated graph sample. Check file
   effects independently from process status. View representative rendered images;
   one inspected PNG does not qualify all rendering behavior.
6. For the optional-file-plugin control, move **only this owned container's**
   installed `lib/gnumeric/1.12.61/plugins` directory to container
   `/out/primary-plugins`, and create an empty directory at the original path.
   Use fresh per-profile HOME/XDG roots; capture version, listings, inventory and
   explicit Paradox attempts. Then copy only the unchanged `paradox` directory
   back to the original plugin root and repeat. Require the recorded activation
   sets, including nine GOffice IDs and optional `Gnumeric_paradox`. Restore all
   primary plugin files after capture, including on failed capture.
   `--lib-dir` and `--data-dir` cannot isolate plugins in this release: their
   accepted values have no observed effect. Preserve that failed experiment as
   unqualified evidence rather than using it as the control.
7. Generate the retained independent Paradox fixture with the original pxlib
   helper, compiling `gcc /evidence/paradox-fixture.c -lpx -o
/evidence/paradox-fixture`. Execute its reader self-check and capture its
   status/output separately from ssconvert's failed explicit/automatic imports.
   Do not assume a successful fixture generator implies successful ssconvert
   import. Preserve the field-declaration export's zero status, diagnostic and
   empty output. Successful optional Paradox conversion remains unqualified.
8. For Psiconv, configure its unchanged 0.9.9 source using `CFLAGS="-g -O2
-fcommon"` and `--prefix=/opt/psiconv-reference`, then build/install. Extract a
   separate unchanged Gnumeric tree in owned scratch. Set `PSICONV_CONFIG` to
   that installation's `bin/psiconv-config`, and the primary GOffice pkg-config/
   library paths. Configure with `--prefix=/opt/ssconvert-optional
--disable-introspection --disable-component --without-python
--enable-plugins=psiconv`. Run `make -C plugins/psiconv -j2`; record the observed
   status 2 and undeclared calls in the profile. Do not patch the release or
   claim this failed-build profile as a successful optional oracle.
9. Qualify the eight remaining explicit importer fixtures (Excel XML, QPro,
   Applix, Lotus, Oleo, Plan Perfect, SC and Xbase), remaining inherited option
   side effects and optional source services with independent evidence. Keep the
   full source-plugin census and requested product scope intact. A finite set of
   successful smoke cases does not qualify all records, calculations, tools,
   graph output or JavaScript implementation behavior.
10. Validate every retained reversible byte record's length/hash, both source
    plugin censuses, source-option inventory, dependency source/package identity,
    and formatting of edited documents. Reduce all owned observations before
    removing scratch. The freeze remains incomplete while Psiconv runtime and
    required qualification gates are unresolved. Do not push or publish.
