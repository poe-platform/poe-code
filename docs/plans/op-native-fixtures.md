# Native op scenario recordings

This checklist is a manual recording workflow, not a saved QA program. The
user requested recordings, not fixture submissions. The earlier fixture-handoff
request is superseded; existing evidence and this linked document path remain.

## Completed recordings

`out/op-native-recordings-uNuPJ6/summary.txt` records 13 scenarios, with text,
timed stdout/stderr casts and inspected screenshots. No installed `op` was
found in the checked locations: the integrity-verified extracted official
2.39.0 oracle was explicitly labeled and used instead.

- Version, root/item help, plugin metadata and literal-only run succeed.
- Invalid password recipe and file mode fail at the parser boundary.
- Template list/get, item get/list and actual POSIX-piped literal inject stop
  at no accounts configured. The initial Node-spawned inject transport failure
  remains recorded separately; neither attempt proves authenticated injection.
- No item timestamp output or complete template schemas were obtained.
  Help accepting `--iso-timestamps` and diagnostic log times do not prove item
  timestamp units, fields, precision or formatting.
- Casts are timed stream captures, not interactive TTY sessions. No credentials,
  network-native operations, account mutations or authenticated outputs were used.

## Safe manual workflow

The user has now authorized Ptolemy's authentication/synthetic-recording work
in one designated agent vault. Only that assigned workflow may use this bounded
authorization; do not expand it to other vaults or expose the real identifier in
documentation examples. Its results are pending and separate from the completed
no-auth recordings above. No fixture submission or native config integration is
required.

1. Identify the executable before every comparison. Record its explicit path,
   version and, for a downloaded oracle, official origin and verified integrity.
   The package and official CLI both use the name `op`; never infer identity
   from that name or silently substitute a different version.
2. Use isolated synthetic state and explicitly selected environment variables.
   Do not inspect private homes, native account configuration, tokens, keychains,
   user SSH files or existing personal/work vaults. Do not log environment dumps.
3. Record no-auth version/help, public plugin metadata, parser rejection and
   literal-only execution scenarios. For local SDK/Node behavior, start with a
   generic object seed and object-form vault references, not native config.
4. Preserve safe argv, exit status, stdout/stderr and capture conditions
   (OS, locale, timezone, width and TTY versus redirected output). Inspect
   screenshots and diagnostics for both readability and accidental private data.
   Label edits/redactions; altered output is not byte-exact evidence.
5. Outside the specifically authorized workflow, if native execution reaches
   authentication or an unavailable service, stop and record the boundary.
   Do not sign in, collect credentials or
   access account data to turn it into a passing comparison. No user-supplied
   bundle is required to complete a recording.
6. Keep recordings and summaries under ignored `out/`; retain earlier evidence
   rather than rewriting failures as successful native behavior.

## Evidence still unavailable

Complete pinned category templates beyond Login remain unavailable. Future safe
recordings, if an independently authorized synthetic environment becomes
available, must preserve category identifiers, complete fields/sections, order,
types and defaults before schemas can be implemented faithfully. Provider
schemas and category labels alone are not substitutes.

Timestamp and detailed-list behavior likewise needs actual synthetic item
output: compare get/list, JSON/human-readable, ordinary list versus `--long`,
and explicit ISO true/false on unchanged data. Those comparisons have not run
successfully here. Do not infer units or native formatting from local seed
values, parser acceptance or help.

## Object storage boundary

There is deliberately no native 1Password config integration. The SDK accepts
`createObjectBackend(seed)`; Node accepts only an explicit `OP_BACKEND_FILE`
or trusted `OP_BACKEND_MODULE`. `--config`/`OP_CONFIG_DIR` are accepted
interface metadata, ignored by built-in storage and forwarded to custom
backends. No native-directory mapping decision or private config submission is
needed. File-backed resolved approval remains separately unsupported; this
storage security limitation is not a request for native configuration.
