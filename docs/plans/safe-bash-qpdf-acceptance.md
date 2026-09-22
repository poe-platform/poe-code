# qpdf acceptance matrix

Contract: [pinned research](safe-bash-qpdf-research.md). Oracle work: [independent controls](compatibility-qpdf.md). All product gates are **OPEN / unimplemented** at inspected main ab1fa8d34101e1e7f61272973f3bc28a842043d8. Native observations constrain expectations; they do not constitute implementation acceptance. Transformations, encryption and writing are required scope, not replaced by inspection-only admission.

Every gate needs failing memory-VFS/memfs tests before code, passing implementation tests, independently acquired expected bytes/semantics, cancellation/budget/cleanup failure controls, and CLI/SDK equality. An optional external capability is mocked in unit tests; absence must fail explicitly, never invoke a host fallback. Native calls belong only to manual QA. Every accepted generated PDF must independently pass pinned qpdf --check; renderer/text/navigation checks additionally apply where needed. No assertion weakening, timeout increases, optional-case pass counts or engine-produced goldens.

## Capability gates

| Gate | Chosen capability | Required distinct qualification |
| --- | --- | --- |
| G01 | Scoped CLI grammar | pages/encrypt/overlay/underlay/attachments terminators, misplaced tokens, positional/dashed alternatives, repeated/order/omitted options |
| G02 | Input/output modes | stdin rejection, permitted stdout, inspection output denial, empty input zero pages, alias identity |
| G03 | General status/diagnostics | clean/error/warning; no-warn and warning-exit-0, binary-safe stdout routing |
| G04 | Encryption predicates | independent encrypted/password statuses and mutual exclusion, damaged recovery stderr |
| G05 | Structural check | classic/stream/hybrid xref, incremental revisions, recovery/no-recovery; structural-only limits |
| G06 | Show xref | exact offsets/generations/compressed entries and diagnostics; complete captured golden required |
| G07 | Show object | bounded obj/gen/trailer grammar, scalars/alias graph, exact text; raw and filtered bytes separately |
| G08 | Page inspection | show-npages/show-pages/with-images, object identities vs semantic pages |
| G09 | Document JSON v1 | every key, lexical types/escaping/order/schema, selector none/unknown/trailer |
| G10 | Document JSON v2 | qpdf vs objects/objectinfo exclusion, all/none distinct, no selector disclosure |
| G11 | JSON inline/none | default distinction json/json-output; exact base64/omission, limits |
| G12 | JSON file streams | stdout prefix requirement, sidecar naming, collision/identity/multi-file effects |
| G13 | JSON input | external byte references via VFS, schema/version/topology, structural round trip |
| G14 | JSON update | object identity/graph replacement and stream references; malformed schema/base64/security |
| G15 | Job JSON | independent job schema v1, equivalent CLI jobs, VFS files, no ambient authority |
| G16 | Rewrite serializer | offsets/lengths/escaping/xref/trailer; unknown retained objects/raw streams/aliasing; parser alone insufficient |
| G17 | Unreferenced graph policy | reachable-default vs preserve-unreferenced; historical objects/revisions not all retained |
| G18 | Empty PDF | zero-page valid writer, then metadata-free import; no synthetic source metadata |
| G19 | Range expansion | descending/reverse/repeats/leading-zero/endpoints/integer bounds; budget before expansion |
| G20 | Exclusions/parity | latest-group exclusion, repeated exclusions, parity final positions, empty success |
| G21 | Multi-source merge | foreign object collisions/alias maps, encrypted input passwords, resources/cycles/unequal sources |
| G22 | Collation | bare/one/per-selection widths, unequal lengths; documented zero rejection |
| G23 | Page inheritance/edit | nearest MediaBox/CropBox/Resources/Rotate only, direct sharing, intermediate unknown key warning/root retention |
| G24 | Split | filename/range width/group count, last group/empty/duplicates, stdout denial, complete publication boundary |
| G25 | Info preservation/removal | primary/import/split separately; ModDate and catalog Metadata side effects |
| G26 | Real XMP preservation/removal | original valid XMP bytes/namespaces, primary/import/split; synthetic XML insufficient |
| G27 | Outlines/destinations | removed/duplicate/reordered/foreign pages; native stale destinations explicitly distinguished from repair |
| G28 | Forms/annotations | copied fields/name collisions/appearances, repair warnings, widgets and remove-acroform |
| G29 | Attachments | byte/name-tree fidelity primary/import/split, add/list/show/remove/copy/prefix/replace and collisions |
| G30 | Labels | selected-source label rebuilding, repeats/reorder, split rebasing, set/remove grammar |
| G31 | Threads/structure | tagged graph, MarkInfo, threads, imported/split relations and remove-structure |
| G32 | Signatures | explicit invalidation/preservation policy, no fidelity claim from --check |
| G33 | Rotation | absolute vs signed/inherited modulo, selected ranges/repeats/order and rendered positions |
| G34 | Flatten rotation | boxes/resources/content/annotations transformed consistently; screenshot qualification |
| G35 | Overlay | scoped from/to/repeat mapping, resource ownership, render/content fidelity |
| G36 | Underlay | separate stacking behavior/control, scoped grammar and cancellation |
| G37 | Encryption reader | separate R2/R3/R4/R5/R6 × RC4/AES controls, wrong/correct user/owner, object/stream crypt filters |
| G38 | Encryption writer | same revisions/methods independently, permissions/metadata/insecure/weak policy and qpdf readback |
| G39 | Decrypt/copy encryption | preserve vs explicit decrypt/encrypt/copy and forced version/QDF interactions |
| G40 | Password semantics | bytes/hex/unicode/auto/recovery, UTF8/127 truncation/NUL, no secret diagnostics or unsafe retry |
| G41 | Crypto primitives | independent digests/AES, arbitrary chunk boundaries, R6 round/work cap and per-round cancellation |
| G42 | Object streams | preserve/disable/generate, forced/minimum version, encrypted and linearized combinations |
| G43 | Filter decoding | each generalized/specialized/all filter individually, unsupported raw preserve, chain/decode params/expansion limits |
| G44 | Compression | Flate preservation/recompress, compress-streams/stream-data order, levels1..9, modified/empty/metadata streams |
| G45 | QDF/normalization | default vs explicit config/order, encryption/version effects, normalized syntax and render semantics |
| G46 | Linearization | two-pass writer/hints/offsets/IDs, check-linearization and real partial range-reader proof |
| G47 | IDs | retained first/regenerated second, deterministic filename independence/encryption rejection, explicit clock/random |
| G48 | Coalescing | content order/stream separators/resources; text/render unchanged |
| G49 | Resource pruning | unreferenced page/resource graph and preserve overrides, no dropped used resources |
| G50 | Inline image externalization | II thresholds, parsing/binary boundaries, resource reuse and decoded pixels |
| G51 | Image optimization | area/width/height/JPEG thresholds; explicit codecs only; pixels/loss policy and screenshots |
| G52 | Annotation flattening | all/print/screen visibility, stale appearance handling, AcroForm effects |
| G53 | Appearance generation | supported field/font/encoding limitations, widget consistency and rendered values |
| G54 | Restrictions/removal | remove-restrictions, separate metadata/Info/structure/forms; no redaction claim |
| G55 | VFS replace/publication | exclusive stage, source identity changes, backup collisions, denied sinks, complete-effect boundary |
| G56 | Budgets/cancellation/cleanup | preallocation accounting, malicious graphs/filter bombs/repeated ranges, sink backpressure, rollback/falsey throws |
| G57 | Runtime isolation | no host/network/ambient/native/WASM/download, explicit capabilities, realm/byte ownership and replay |
| G58 | Private package/build | required name/private/ESM/no external runtime deps, maintained workspace DAG/checks, narrow package logic |
| G59 | Installed API | commands/qpdf actual packed import/CLI/SDK/byte brand/constructor identity; JS/d.ts no unpublished specifier |
| G60 | Help and option admission | all140 names/versioned values/scopes, exact explicit rejection, no fallback or silent ignore |

Each listed subvariant remains individually open until its own fixture and expected outcome exist. Passing G05 never closes G16, G27, G32 or G46. Passing a hash primitive never closes G37/G38/G40/G41. Catalog presence never closes semantic metadata gates.

## Named-option coverage and failure contract

The following140 options were supplied from pinned --help=all. **U** = unimplemented, chosen for qualification; **R** = intentional product rejection, also unimplemented. **No option is currently supported**: no command registration/export exists, so the exact current command-not-found output depends on the caller. Do not misreport the following proposed failures as observed current behavior.

Future admission failure contract: for U before its gate is admitted, stdout empty, stderr exactly `qpdf: unsupported option: --NAME\n`, status2, no VFS mutation. For R, stdout empty, stderr exactly `qpdf: option intentionally unavailable: --NAME\n`, status2, no VFS mutation. Rows substitute the complete option name shown; parameter values/passwords must not appear in diagnostics. This intentionally differs from native support. Individual gates below also require native grammar/default/effect controls: named help inventory alone is insufficient.

Production rejects static AES IV, host completions/open-file/native memory/debug/temp-pass options and alternative zopfli backend. Parser tuning options may lower limits only; no-default-limits is rejected rather than disabling safety budgets. Test fixtures can use a separately explicit deterministic crypto capability; production CLI/SDK cannot admit static AES IV. Argument files are not among named options and require their own G01/G57 VFS qualification.

| Option | Status | Independent option gate | Capability gates | Exact failure |
| --- | --- | --- | --- | --- |
| `--accessibility` | U | O001 (OPEN) | G37–G41 | `qpdf: unsupported option: --accessibility\n`, status2 |
| `--add-attachment` | U | O002 (OPEN) | G29 | `qpdf: unsupported option: --add-attachment\n`, status2 |
| `--allow-insecure` | U | O003 (OPEN) | G37–G41 | `qpdf: unsupported option: --allow-insecure\n`, status2 |
| `--allow-weak-crypto` | U | O004 (OPEN) | G37–G41 | `qpdf: unsupported option: --allow-weak-crypto\n`, status2 |
| `--annotate` | U | O005 (OPEN) | G37–G41 | `qpdf: unsupported option: --annotate\n`, status2 |
| `--assemble` | U | O006 (OPEN) | G37–G41 | `qpdf: unsupported option: --assemble\n`, status2 |
| `--bits` | U | O007 (OPEN) | G37–G41 | `qpdf: unsupported option: --bits\n`, status2 |
| `--check` | U | O008 (OPEN) | G03–G08 | `qpdf: unsupported option: --check\n`, status2 |
| `--check-linearization` | U | O009 (OPEN) | G46 | `qpdf: unsupported option: --check-linearization\n`, status2 |
| `--cleartext-metadata` | U | O010 (OPEN) | G37–G41 | `qpdf: unsupported option: --cleartext-metadata\n`, status2 |
| `--coalesce-contents` | U | O011 (OPEN) | G48–G54 | `qpdf: unsupported option: --coalesce-contents\n`, status2 |
| `--collate` | U | O012 (OPEN) | G18–G24 | `qpdf: unsupported option: --collate\n`, status2 |
| `--completion-bash` | R | O013 (OPEN) | G01/G57/G60 | `qpdf: option intentionally unavailable: --completion-bash\n`, status2 |
| `--completion-zsh` | R | O014 (OPEN) | G01/G57/G60 | `qpdf: option intentionally unavailable: --completion-zsh\n`, status2 |
| `--compress-streams` | U | O015 (OPEN) | G42–G47 | `qpdf: unsupported option: --compress-streams\n`, status2 |
| `--compression-level` | U | O016 (OPEN) | G42–G47 | `qpdf: unsupported option: --compression-level\n`, status2 |
| `--copy-attachments-from` | U | O017 (OPEN) | G29 | `qpdf: unsupported option: --copy-attachments-from\n`, status2 |
| `--copy-encryption` | U | O018 (OPEN) | G37–G41 | `qpdf: unsupported option: --copy-encryption\n`, status2 |
| `--copyright` | U | O019 (OPEN) | G01/G57/G60 | `qpdf: unsupported option: --copyright\n`, status2 |
| `--creationdate` | U | O020 (OPEN) | G29 | `qpdf: unsupported option: --creationdate\n`, status2 |
| `--decode-level` | U | O021 (OPEN) | G42–G47 | `qpdf: unsupported option: --decode-level\n`, status2 |
| `--decrypt` | U | O022 (OPEN) | G37–G41 | `qpdf: unsupported option: --decrypt\n`, status2 |
| `--description` | U | O023 (OPEN) | G29 | `qpdf: unsupported option: --description\n`, status2 |
| `--deterministic-id` | U | O024 (OPEN) | G42–G47 | `qpdf: unsupported option: --deterministic-id\n`, status2 |
| `--empty` | U | O025 (OPEN) | G18–G24 | `qpdf: unsupported option: --empty\n`, status2 |
| `--encrypt` | U | O026 (OPEN) | G37–G41 | `qpdf: unsupported option: --encrypt\n`, status2 |
| `--encryption-file-password` | U | O027 (OPEN) | G37–G41 | `qpdf: unsupported option: --encryption-file-password\n`, status2 |
| `--externalize-inline-images` | U | O028 (OPEN) | G48–G54 | `qpdf: unsupported option: --externalize-inline-images\n`, status2 |
| `--extract` | U | O029 (OPEN) | G37–G41 | `qpdf: unsupported option: --extract\n`, status2 |
| `--file` | U | O030 (OPEN) | G18–G24 | `qpdf: unsupported option: --file\n`, status2 |
| `--filename` | U | O031 (OPEN) | G29 | `qpdf: unsupported option: --filename\n`, status2 |
| `--filtered-stream-data` | U | O032 (OPEN) | G03–G08 | `qpdf: unsupported option: --filtered-stream-data\n`, status2 |
| `--flatten-annotations` | U | O033 (OPEN) | G48–G54 | `qpdf: unsupported option: --flatten-annotations\n`, status2 |
| `--flatten-rotation` | U | O034 (OPEN) | G33–G36 | `qpdf: unsupported option: --flatten-rotation\n`, status2 |
| `--force-R5` | U | O035 (OPEN) | G37–G41 | `qpdf: unsupported option: --force-R5\n`, status2 |
| `--force-V4` | U | O036 (OPEN) | G37–G41 | `qpdf: unsupported option: --force-V4\n`, status2 |
| `--force-version` | U | O037 (OPEN) | G42–G47 | `qpdf: unsupported option: --force-version\n`, status2 |
| `--form` | U | O038 (OPEN) | G37–G41 | `qpdf: unsupported option: --form\n`, status2 |
| `--from` | U | O039 (OPEN) | G33–G36 | `qpdf: unsupported option: --from\n`, status2 |
| `--generate-appearances` | U | O040 (OPEN) | G48–G54 | `qpdf: unsupported option: --generate-appearances\n`, status2 |
| `--global` | U | O041 (OPEN) | G01/G57/G60 | `qpdf: unsupported option: --global\n`, status2 |
| `--help` | U | O042 (OPEN) | G01/G57/G60 | `qpdf: unsupported option: --help\n`, status2 |
| `--ignore-xref-streams` | U | O043 (OPEN) | G03–G08 | `qpdf: unsupported option: --ignore-xref-streams\n`, status2 |
| `--ii-min-bytes` | U | O044 (OPEN) | G48–G54 | `qpdf: unsupported option: --ii-min-bytes\n`, status2 |
| `--is-encrypted` | U | O045 (OPEN) | G03–G08 | `qpdf: unsupported option: --is-encrypted\n`, status2 |
| `--job-json-file` | U | O046 (OPEN) | G09–G15 | `qpdf: unsupported option: --job-json-file\n`, status2 |
| `--job-json-help` | U | O047 (OPEN) | G09–G15 | `qpdf: unsupported option: --job-json-help\n`, status2 |
| `--jpeg-quality` | U | O048 (OPEN) | G48–G54 | `qpdf: unsupported option: --jpeg-quality\n`, status2 |
| `--json` | U | O049 (OPEN) | G09–G15 | `qpdf: unsupported option: --json\n`, status2 |
| `--json-help` | U | O050 (OPEN) | G09–G15 | `qpdf: unsupported option: --json-help\n`, status2 |
| `--json-input` | U | O051 (OPEN) | G09–G15 | `qpdf: unsupported option: --json-input\n`, status2 |
| `--json-key` | U | O052 (OPEN) | G09–G15 | `qpdf: unsupported option: --json-key\n`, status2 |
| `--json-object` | U | O053 (OPEN) | G09–G15 | `qpdf: unsupported option: --json-object\n`, status2 |
| `--json-output` | U | O054 (OPEN) | G09–G15 | `qpdf: unsupported option: --json-output\n`, status2 |
| `--json-stream-data` | U | O055 (OPEN) | G09–G15 | `qpdf: unsupported option: --json-stream-data\n`, status2 |
| `--json-stream-prefix` | U | O056 (OPEN) | G09–G15 | `qpdf: unsupported option: --json-stream-prefix\n`, status2 |
| `--keep-files-open` | R | O057 (OPEN) | G01/G57/G60 | `qpdf: option intentionally unavailable: --keep-files-open\n`, status2 |
| `--keep-files-open-threshold` | R | O058 (OPEN) | G01/G57/G60 | `qpdf: option intentionally unavailable: --keep-files-open-threshold\n`, status2 |
| `--keep-inline-images` | U | O059 (OPEN) | G48–G54 | `qpdf: unsupported option: --keep-inline-images\n`, status2 |
| `--key` | U | O060 (OPEN) | G29 | `qpdf: unsupported option: --key\n`, status2 |
| `--linearize` | U | O061 (OPEN) | G42–G47 | `qpdf: unsupported option: --linearize\n`, status2 |
| `--linearize-pass1` | R | O062 (OPEN) | G01/G57/G60 | `qpdf: option intentionally unavailable: --linearize-pass1\n`, status2 |
| `--list-attachments` | U | O063 (OPEN) | G29 | `qpdf: unsupported option: --list-attachments\n`, status2 |
| `--max-stream-filters` | U | O064 (OPEN) | G56 | `qpdf: unsupported option: --max-stream-filters\n`, status2 |
| `--mimetype` | U | O065 (OPEN) | G29 | `qpdf: unsupported option: --mimetype\n`, status2 |
| `--min-version` | U | O066 (OPEN) | G42–G47 | `qpdf: unsupported option: --min-version\n`, status2 |
| `--moddate` | U | O067 (OPEN) | G29 | `qpdf: unsupported option: --moddate\n`, status2 |
| `--modify` | U | O068 (OPEN) | G37–G41 | `qpdf: unsupported option: --modify\n`, status2 |
| `--modify-other` | U | O069 (OPEN) | G37–G41 | `qpdf: unsupported option: --modify-other\n`, status2 |
| `--newline-before-endstream` | U | O070 (OPEN) | G42–G47 | `qpdf: unsupported option: --newline-before-endstream\n`, status2 |
| `--no-default-limits` | R | O071 (OPEN) | G01/G57/G60 | `qpdf: option intentionally unavailable: --no-default-limits\n`, status2 |
| `--no-original-object-ids` | U | O072 (OPEN) | G42–G47 | `qpdf: unsupported option: --no-original-object-ids\n`, status2 |
| `--no-warn` | U | O073 (OPEN) | G03–G08 | `qpdf: unsupported option: --no-warn\n`, status2 |
| `--normalize-content` | U | O074 (OPEN) | G42–G47 | `qpdf: unsupported option: --normalize-content\n`, status2 |
| `--object-streams` | U | O075 (OPEN) | G42–G47 | `qpdf: unsupported option: --object-streams\n`, status2 |
| `--oi-min-area` | U | O076 (OPEN) | G48–G54 | `qpdf: unsupported option: --oi-min-area\n`, status2 |
| `--oi-min-height` | U | O077 (OPEN) | G48–G54 | `qpdf: unsupported option: --oi-min-height\n`, status2 |
| `--oi-min-width` | U | O078 (OPEN) | G48–G54 | `qpdf: unsupported option: --oi-min-width\n`, status2 |
| `--optimize-images` | U | O079 (OPEN) | G48–G54 | `qpdf: unsupported option: --optimize-images\n`, status2 |
| `--overlay` | U | O080 (OPEN) | G33–G36 | `qpdf: unsupported option: --overlay\n`, status2 |
| `--owner-password` | U | O081 (OPEN) | G37–G41 | `qpdf: unsupported option: --owner-password\n`, status2 |
| `--pages` | U | O082 (OPEN) | G18–G24 | `qpdf: unsupported option: --pages\n`, status2 |
| `--parser-max-container-size` | U | O083 (OPEN) | G56 | `qpdf: unsupported option: --parser-max-container-size\n`, status2 |
| `--parser-max-container-size-damaged` | U | O084 (OPEN) | G56 | `qpdf: unsupported option: --parser-max-container-size-damaged\n`, status2 |
| `--parser-max-errors` | U | O085 (OPEN) | G56 | `qpdf: unsupported option: --parser-max-errors\n`, status2 |
| `--parser-max-nesting` | U | O086 (OPEN) | G56 | `qpdf: unsupported option: --parser-max-nesting\n`, status2 |
| `--password` | U | O087 (OPEN) | G37–G41 | `qpdf: unsupported option: --password\n`, status2 |
| `--password-file` | U | O088 (OPEN) | G37–G41 | `qpdf: unsupported option: --password-file\n`, status2 |
| `--password-is-hex-key` | U | O089 (OPEN) | G37–G41 | `qpdf: unsupported option: --password-is-hex-key\n`, status2 |
| `--password-mode` | U | O090 (OPEN) | G37–G41 | `qpdf: unsupported option: --password-mode\n`, status2 |
| `--prefix` | U | O091 (OPEN) | G29 | `qpdf: unsupported option: --prefix\n`, status2 |
| `--preserve-unreferenced` | U | O092 (OPEN) | G17 | `qpdf: unsupported option: --preserve-unreferenced\n`, status2 |
| `--preserve-unreferenced-resources` | U | O093 (OPEN) | G48–G54 | `qpdf: unsupported option: --preserve-unreferenced-resources\n`, status2 |
| `--print` | U | O094 (OPEN) | G37–G41 | `qpdf: unsupported option: --print\n`, status2 |
| `--progress` | U | O095 (OPEN) | G01/G57/G60 | `qpdf: unsupported option: --progress\n`, status2 |
| `--qdf` | U | O096 (OPEN) | G42–G47 | `qpdf: unsupported option: --qdf\n`, status2 |
| `--range` | U | O097 (OPEN) | G18–G24 | `qpdf: unsupported option: --range\n`, status2 |
| `--raw-stream-data` | U | O098 (OPEN) | G03–G08 | `qpdf: unsupported option: --raw-stream-data\n`, status2 |
| `--recompress-flate` | U | O099 (OPEN) | G42–G47 | `qpdf: unsupported option: --recompress-flate\n`, status2 |
| `--remove-acroform` | U | O100 (OPEN) | G48–G54 | `qpdf: unsupported option: --remove-acroform\n`, status2 |
| `--remove-attachment` | U | O101 (OPEN) | G29 | `qpdf: unsupported option: --remove-attachment\n`, status2 |
| `--remove-info` | U | O102 (OPEN) | G48–G54 | `qpdf: unsupported option: --remove-info\n`, status2 |
| `--remove-metadata` | U | O103 (OPEN) | G48–G54 | `qpdf: unsupported option: --remove-metadata\n`, status2 |
| `--remove-page-labels` | U | O104 (OPEN) | G48–G54 | `qpdf: unsupported option: --remove-page-labels\n`, status2 |
| `--remove-restrictions` | U | O105 (OPEN) | G48–G54 | `qpdf: unsupported option: --remove-restrictions\n`, status2 |
| `--remove-structure` | U | O106 (OPEN) | G48–G54 | `qpdf: unsupported option: --remove-structure\n`, status2 |
| `--remove-unreferenced-resources` | U | O107 (OPEN) | G48–G54 | `qpdf: unsupported option: --remove-unreferenced-resources\n`, status2 |
| `--repeat` | U | O108 (OPEN) | G33–G36 | `qpdf: unsupported option: --repeat\n`, status2 |
| `--replace` | U | O109 (OPEN) | G29 | `qpdf: unsupported option: --replace\n`, status2 |
| `--replace-input` | U | O110 (OPEN) | G55 | `qpdf: unsupported option: --replace-input\n`, status2 |
| `--report-memory-usage` | R | O111 (OPEN) | G01/G57/G60 | `qpdf: option intentionally unavailable: --report-memory-usage\n`, status2 |
| `--requires-password` | U | O112 (OPEN) | G03–G08 | `qpdf: unsupported option: --requires-password\n`, status2 |
| `--rotate` | U | O113 (OPEN) | G33–G36 | `qpdf: unsupported option: --rotate\n`, status2 |
| `--set-page-labels` | U | O114 (OPEN) | G48–G54 | `qpdf: unsupported option: --set-page-labels\n`, status2 |
| `--show-attachment` | U | O115 (OPEN) | G29 | `qpdf: unsupported option: --show-attachment\n`, status2 |
| `--show-crypto` | U | O116 (OPEN) | G37–G41 | `qpdf: unsupported option: --show-crypto\n`, status2 |
| `--show-encryption` | U | O117 (OPEN) | G37–G41 | `qpdf: unsupported option: --show-encryption\n`, status2 |
| `--show-encryption-key` | U | O118 (OPEN) | G37–G41 | `qpdf: unsupported option: --show-encryption-key\n`, status2 |
| `--show-linearization` | U | O119 (OPEN) | G46 | `qpdf: unsupported option: --show-linearization\n`, status2 |
| `--show-npages` | U | O120 (OPEN) | G03–G08 | `qpdf: unsupported option: --show-npages\n`, status2 |
| `--show-object` | U | O121 (OPEN) | G03–G08 | `qpdf: unsupported option: --show-object\n`, status2 |
| `--show-pages` | U | O122 (OPEN) | G03–G08 | `qpdf: unsupported option: --show-pages\n`, status2 |
| `--show-xref` | U | O123 (OPEN) | G03–G08 | `qpdf: unsupported option: --show-xref\n`, status2 |
| `--split-pages` | U | O124 (OPEN) | G18–G24 | `qpdf: unsupported option: --split-pages\n`, status2 |
| `--static-aes-iv` | R | O125 (OPEN) | G01/G57/G60 | `qpdf: option intentionally unavailable: --static-aes-iv\n`, status2 |
| `--static-id` | U | O126 (OPEN) | G42–G47 | `qpdf: unsupported option: --static-id\n`, status2 |
| `--stream-data` | U | O127 (OPEN) | G42–G47 | `qpdf: unsupported option: --stream-data\n`, status2 |
| `--suppress-password-recovery` | U | O128 (OPEN) | G37–G41 | `qpdf: unsupported option: --suppress-password-recovery\n`, status2 |
| `--suppress-recovery` | U | O129 (OPEN) | G03–G08 | `qpdf: unsupported option: --suppress-recovery\n`, status2 |
| `--test-json-schema` | U | O130 (OPEN) | G09–G15 | `qpdf: unsupported option: --test-json-schema\n`, status2 |
| `--to` | U | O131 (OPEN) | G33–G36 | `qpdf: unsupported option: --to\n`, status2 |
| `--underlay` | U | O132 (OPEN) | G33–G36 | `qpdf: unsupported option: --underlay\n`, status2 |
| `--update-from-json` | U | O133 (OPEN) | G09–G15 | `qpdf: unsupported option: --update-from-json\n`, status2 |
| `--use-aes` | U | O134 (OPEN) | G37–G41 | `qpdf: unsupported option: --use-aes\n`, status2 |
| `--user-password` | U | O135 (OPEN) | G37–G41 | `qpdf: unsupported option: --user-password\n`, status2 |
| `--verbose` | U | O136 (OPEN) | G01/G57/G60 | `qpdf: unsupported option: --verbose\n`, status2 |
| `--version` | U | O137 (OPEN) | G01/G57/G60 | `qpdf: unsupported option: --version\n`, status2 |
| `--warning-exit-0` | U | O138 (OPEN) | G03–G08 | `qpdf: unsupported option: --warning-exit-0\n`, status2 |
| `--with-images` | U | O139 (OPEN) | G03–G08 | `qpdf: unsupported option: --with-images\n`, status2 |
| `--zopfli` | R | O140 (OPEN) | G01/G57/G60 | `qpdf: option intentionally unavailable: --zopfli\n`, status2 |

All option gates O001–O140 remain OPEN. R gates close only after exact rejection and no-effects tests pass through both CLI and SDK and packed consumers. U gates close only after native compatibility plus responsible capability gates pass. Any newly admitted option must update this inventory and help; unsupported settings fail before output acquisition.
