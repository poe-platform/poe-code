# htmlq pinned acceptance matrix

This is the independent compatibility specification for `research-htmlq`, not an implementation test suite. Engine, selector, command wiring and publication tasks remain open. No htmlq runtime or scaffold is introduced by this research task.

## Pin and evidence

Pin [mgdm/htmlq bfcb1d1d11a80fdd92c0dace1e7e559fbdb225cb](https://github.com/mgdm/htmlq/tree/bfcb1d1d11a80fdd92c0dace1e7e559fbdb225cb), Cargo package version **0.5.0**, rather than a moving branch or version label alone. The supplied research record reports `cargo --locked --release` with rustc 1.98.1, kuchikiki 0.8.2, html5ever 0.26.0, selectors 0.22.0, url 2.5.8 and clap 4.6.1. It reports 107 original controls plus eleven BOM controls. Their raw transcripts are not available in this checkout; this task does not claim to have rerun them or reconstruct all 107 observations.

On 2026-09-20, local `main` at `ab1fa8d34101e1e7f61272973f3bc28a842043d8` contained the draft plan but no htmlq package, implementation or tests. Current safe-bash sources and manifest likewise have no htmlq command/export. Inspection directly reread pinned `src/main.rs`, `src/link.rs` and `src/pretty_print.rs`. Concrete documentation gaps were the contradictory claim that no native build had run and a trigger-only matrix without exact fixtures. Runtime repairs are therefore outside this task.

The requested package-pattern document is moved to [archive/safe-bash-command-package-pattern.md](archive/safe-bash-command-package-pattern.md) in unrelated working-tree edits. Follow that contract without restoring the deleted path: `packages/safe-bash-command-htmlq`, name `safe-bash-command-htmlq`, `private: true`, TypeScript ESM, no external runtime dependencies; safe-bash composes and exports `@poe-platform/safe-bash/commands/htmlq`. Bundle private implementation and declarations into the installed safe-bash artifact. No unpublished import may escape. No publication of the private package is authorized.

Checksum-verified dependency archives in the supplied research record were development-only source inspection/native oracle inputs:

| Archive | SHA256 |
| --- | --- |
| kuchikiki 0.8.2 | f29e4755b7b995046f510a7520c42b2fed58b77bd94d5a87a8eb43d2fd126da8 |
| html5ever 0.26.0 | bea68cab48b8459f17cf1c944c67ddc572d272d9f2b274140f223ecb1da4a3b7 |
| selectors 0.22.0 | df320f1889ac4ba6bc0cdc9c9af7af4bd64bb927bccdf32d81140dc1f9be12fe |
| cssparser 0.27.2 | 754b69d351cdc2d8ee09ae203db831e005560fc6030da058f86ad60c92a9cb0a |

## Invocation and processing contract

Arguments below are literal argv entries, not shell expressions or filenames inferred from selector text. Optional selector defaults to `html`. Input is stdin unless `-f/--filename` explicitly names a VFS input; `-` denotes stdin. Output defaults to stdout; `-o/--output` names a VFS output, with `-` denoting stdout. There is no second positional filename. Native file I/O is oracle behavior only: product I/O is exclusively capability-owned VFS and byte streams.

| Option | Interaction |
| --- | --- |
| `-a/--attributes NAME` | Repeatable, requested order, decoded unescaped values, one LF per present value; empty value emits LF, absent value emits nothing. Correct spelling is plural `--attributes`; singular `--attribute` is not an alias. |
| `-t/--text` | Concatenate ordinary inclusive descendant text without separators, then one result LF. No HTML escaping. |
| `-i/--ignore-whitespace` | Only affects text mode: skip Rust-trim whitespace-only nodes; retain other nodes verbatim and append LF to each, then append result LF. |
| `-p/--pretty` | Stateful HTML serializer; does not combine with text/attribute output. |
| `-r/--remove-nodes SELECTOR` | Repeatable selectors joined by comma; detach only the first inclusive match per selected result. Invalid removal query is ignored by native. |
| `-b/--base URL` | Parse absolute base; invalid base disables rewriting unless detection succeeds. |
| `-B/--detect-base` | Parse href of first `base` only. Valid detection wins over explicit base; absent/invalid first base falls back to valid explicit base. |

Pipeline: parse full HTML document → determine base → lazy document-order selection → first inclusive removal → rewrite selected element → project. Attributes override text, text overrides pretty, pretty overrides ordinary HTML. `-i` does not change ordinary/pretty HTML or attributes. No-match succeeds with zero stdout bytes. Selector lists return matching elements once in tree order absent mutation, not selector-list order. Mutation can truncate traversal or retain queued detached nodes; do not substitute snapshot queries or remove-all logic.

Rewriting touches only the selected node's `href` when its local name is `a`, `area` or `link`; not descendant links or `img src`. With a usable base, href starting `////` loses **all** leading slashes without joining. Otherwise Rust URL join is used; join failure substitutes serialized base. Existing absolute URLs, including `javascript:`, are preserved/normalized as URL data. Neither selection nor rewriting sanitizes HTML or fetches resources.

## Exact original fixtures

All input/output strings use JSON escapes and UTF-8 encoding; `\n` is byte 10, `\u0000` is byte 0, `\u00a0` is NBSP, `\ufeff` is BOM. No input includes a trailing LF unless shown. argv excludes executable name. Every row has stderr `""` and status **0**. `S` means expectation derived from the reread pinned source plus the documented dependency contract, pending an independent native replay of this exact fixture. `R` means this exact mutation case is reported in the supplied native research. Neither is an implementation pass.

| ID | stdin | argv | stdout | Basis |
| --- | --- | --- | --- | --- |
| A01 | `<p>A</p>` | `[]` | `<html><head></head><body><p>A</p></body></html>\n` | S |
| A02 | `<p>A</p>` | `[".absent"]` | `""` | S |
| A03 | `<p>B</p><p>A</p>` | `["p", "-t"]` | `B\nA\n` | S |
| A04 | `<p id="a">A</p><p id="b">B</p>` | `["#b,p", "-t"]` | `A\nB\n` | S |
| A05 | `<p title="T" id="I">X</p>` | `["p","-a","id","-a","title","-t","-p"]` | `I\nT\n` | S |
| A06 | `<p title="">X</p>` | `["p","-a","missing","-a","title"]` | `\n` | S |
| A07 | `<p title="&amp;&quot;&lt;&#160;">X</p>` | `["p","--attributes","title"]` | `&"<\u00a0\n` | S |
| A08 | `<p>A<b>B</b>C</p>` | `["p","-t","-p"]` | `ABC\n` | S |
| A09 | `<p> <b>A</b> <i>B</i> </p>` | `["p","-t","-i"]` | `A\nB\n\n` | S |
| A10 | `<p> A <b>B</b></p>` | `["p","-t","-i"]` | ` A \nB\n\n` | S |
| A11 | `<p>A<b>B</b></p>` | `["p","-i"]` | `<p>A<b>B</b></p>\n` | S |
| A12 | `<p title="&amp;&quot;&lt;&gt;&#160;">&amp;&lt;&gt;&#160;</p>` | `["p"]` | `<p title="&amp;&quot;<>&nbsp;">&amp;&lt;&gt;&nbsp;</p>\n` | S |
| A13 | `<div><script>a < b && c</script><style>x>y{}</style></div>` | `["div"]` | `<div><script>a < b && c</script><style>x>y{}</style></div>\n` | S |
| A14 | `<div><script>a < b && c</script><style>x>y{}</style></div>` | `["div","-t"]` | `a < b && cx>y{}\n` | S |
| A15 | `<template><p>T</p></template>` | `["template"]` | `<template></template>\n` | S |
| A16 | `<template><p>T</p></template>` | `["template","-t"]` | `\n` | S |
| A17 | `<template><p>T</p></template>` | `["p","-t"]` | `""` | S |
| A18 | `<div id="a"><span>1</span><span>2</span></div><div id="b"><span>3</span></div>` | `["div","-r","span"]` | `<div id="a"><span>2</span></div>\n` | R |
| A19 | Same bytes as A18 | `["div","-r","span:last-child"]` | `<div id="a"><span>1</span></div>\n<div id="b"></div>\n` | R |
| A20 | Same bytes as A18 | `["div,span","-r","span"]` | `<div id="a"><span>2</span></div>\n<span>1</span>\n` | R |
| A21 | `<div><span>X</span></div>` | `["div","-r","div"]` | `<div><span>X</span></div>\n` | S |
| A22 | `<div><b>B</b><i>I</i></div>` | `["div","-r","i","-r","b"]` | `<div><i>I</i></div>\n` | S |
| A23 | `<p>X</p>` | `["p","-r","["]` | `<p>X</p>\n` | S |
| A24 | `<a href="child">X</a>` | `["a","-a","href","-b","https://e.test/dir/"]` | `https://e.test/dir/child\n` | S |
| A25 | `<base href="https://d.test/x/"><a href="child">X</a>` | `["a","-a","href","-B","-b","https://e.test/"]` | `https://d.test/x/child\n` | S |
| A26 | `<base><base href="https://d.test/"><a href="child">X</a>` | `["a","-a","href","-B","-b","https://e.test/"]` | `https://e.test/child\n` | S |
| A27 | `<a href="child">X</a>` | `["a","-a","href","-b","relative"]` | `child\n` | S |
| A28 | `<div><a href="child">X</a><img src="child"></div>` | `["div","-b","https://e.test/"]` | `<div><a href="child">X</a><img src="child"></div>\n` | S |
| A29 | `<a href="/////host/path">X</a>` | `["a","-a","href","-b","https://e.test/"]` | `host/path\n` | S |
| A30 | `<a href="http://[">X</a>` | `["a","-a","href","-b","https://e.test/dir/"]` | `https://e.test/dir/\n` | S |
| A31 | `<a href="javascript:alert(1)">X</a>` | `["a","-a","href","-b","https://e.test/"]` | `javascript:alert(1)\n` | S |
| A32 | `<div><span>X</span></div>` | `["div","-p"]` | `\n<div><span>X</span>\n</div>\n` | S |
| A33 | `<pre> \n </pre>` | `["pre","-p"]` | `\n<pre>\n</pre>\n` | S |
| A34 | `<p>\u00a0<b>\u200b</b></p>` | `["p","-t","-i"]` | `\u200b\n\n` | S |
| A35 | `<p>A\r\nB\rC\u0000D&#0;&#128;</p>` | `["p","-t"]` | `A\nB\nCD\ufffd€\n` | S |
| A36 | `<input checked disabled>` | `[":checked,:disabled,:enabled,:visited","-t"]` | `""` | S |
| A37 | `<p id="a">X</p>` | `["[id=\"A\" i]","-t"]` | `X\n` | S |
| A38 | `<p id="a">X</p>` | `["[id=\"A\" s]","-t"]` | `""` | S |
| A39 | `<a href="">X</a><area href=""><link href="">` | `[":any-link","-a","href"]` | `\n\n\n` | S |
| A40 | `<p>X</p>` | `[":scope"]` | `<html><head></head><body><p>X</p></body></html>\n` | S |

## Parser, selector and writer requirements

The parser is HTML5 document parsing with scripting=true but no script execution. Preserve implied wrappers, table foster parenting/adoption recovery, foreign namespaces, SVG `viewBox`/`foreignObject` adjustments, duplicate attributes first-wins, comments and inert raw text. Template content is a separate fragment: ordinary selectors, text and serialization omit it. Do not reuse the Markdown parser's script/style removal or nonvoid self-closing behavior. Lossy UTF-8 is explicit and chunk-safe; no meta-charset sniffing. Literal ordinary body NUL is omitted, while `&#0;` becomes U+FFFD; `&#128;` becomes euro. Semicolonless named entities require separate attribute/text controls; full entity/recovery parity remains unqualified.

Selector matching uses NoQuirks even for a quirks document. Class separators are only ASCII space/TAB/LF/CR/FF, not NBSP. `:root` and context-free `:scope` resolve the HTML root. `:any-link`/`:link` match HTML a/area/link with href, including empty href. `:visited/:active/:focus/:hover/:enabled/:disabled/:checked/:indeterminate` parse but always return false. Functional nth and nonnested `:not` are supported. Nested `:not`, `:is/:where/:has/:lang` and unregistered named namespace prefixes are rejected; modern browser grammar must not be silently accepted. Exact full selector grammar remains a qualification gate.

Attributes serialize in insertion order, not sorted. Ordinary HTML escapes ampersand and NBSP in text/attributes, doublequote only in attributes, angle brackets only in text. Void serialization includes obsolete keygen/basefont/bgsound. Raw text under script/style/xmp/iframe/noembed/noframes/plaintext/noscript(scripting=true) is unescaped. Doctype serialization is name-only; processing instructions serialize `<?target data>` without a closing question mark. These last two writer cases require direct node controls because selecting elements does not select the document doctype and HTML parsing can turn PI-like syntax into comments.

Pretty starts indent 0 and previous_was_block=false per result. Start-element writes LF+indent when block or previous_was_block, then increments indent by two without updating that state. End-element decrements indent; inline sets state false, block emits LF+indent and sets state true. Retained text writes LF+indent if previous_was_block, then sets state false. Rust-trim whitespace-only text is omitted even in pre; comments/doctype/PI do not update state. Fixed inline list, exactly:

```text
a abbr acronym audio b bdi bdo big button canvas cite code data datalist del
dfn em embed i iframe img input ins kbd label map mark meter noscript object
output picture progress q ruby s samp script select slot small span strong
sub sup svg template textarea time u tt var video wbr
```

Style is absent. Do not replace this with canonical indentation or computed CSS display.

## BOM defect and intentional deviations

For each N in `0,1,2,4092,4093,4094,4095,4096,4097,8191,8192`, construct exact bytes `ASCII("A").repeat(N) + [239,187,191] + ASCII("B")`, argv `["-t"]`. Native reported stderr empty/status 0. At N=0 stdout is `B\n`. At N=1,2,4092,4093,4097 stdout is `A^N + U+FEFF + B + LF`. At N=4094,4095,4096,8191,8192 stdout is incorrectly `A^N + B + LF`.

Product expectation is `B\n` at N=0 and `A^N + U+FEFF + B + LF` at every N>0, invariant under all stream chunkings (including splits within UTF-8 sequences). Strip BOM only at absolute document start. The supplied research attributes native segmentation dependence to tendril 0.4.3's 4096-byte reader and html5ever repeatedly checking an uncleared discard_bom flag. This defect is intentionally not reproduced.

| Trigger | Pinned native stdout/stderr/status | Product acceptance |
| --- | --- | --- |
| Main selector `[` on `<p>X</p>` | Empty stdout; Rust panic diagnostic; 101 | Structured selector error, nonzero status, bounded diagnostic; no panic compatibility claim |
| Main nested `:not`, `:is/:where/:has/:lang`, named namespace prefix | Empty stdout; Rust panic diagnostic; 101 reported | Explicit structured rejection; do not broaden grammar silently |
| Removal selector `[` on `<p>X</p>`, selector `p` | `<p>X</p>\n`, empty stderr, 0 | Preserve ignored invalid removal-query behavior |
| `--tex` or `--attribute` | Empty stdout; Clap argument diagnostic; 2 | Reject unknown flag; shared SDK/CLI argument validation |
| Closed output sink | Native writes discarded via `.ok()`; diagnostic/status depends on transport | Await and observe sink failure; structured nonzero result, cleanup |
| Same/aliased VFS input and output | Native early create/truncate can destroy input | Read admitted input before protected VFS publication; no partial publication on failure |

Panic/Clap stderr is not byte-pinned: build paths, panic location, executable name, environment and backtrace change it. Capture exact bytes in independent replay rather than inventing a transcript. Product error codes, status mapping and diagnostic strings must be specified by command wiring before claiming failure-path completion.

## Independent replay and implementation gates

1. Use an explicitly provisioned isolated development oracle at the pinned commit and locked versions; record toolchain and checksums. Product never launches this executable or adopts its Rust sources, native/WASM parser or dependencies.
2. Reconstruct fixtures directly from this document, preserving literal argv and exact bytes. Capture stdout, stderr, status and VFS/file effects under `/out`; compare bytes before deleting temporary evidence. Label each exact row observed or discrepant. No claim that enumerated results establish full parser/selector grammar parity.
3. Add independent controls for malformed table/adoption trees, SVG/MathML, semicolonless attribute/text entities, ASCII versus NBSP classes, quirks matching, escaped identifiers, nth arithmetic, URL query/fragment/root/network-path cases, first-invalid-base fallback and raw noscript. Record exact expected streams before using them as implementation acceptance. Writer-only node controls stay separate from CLI fixtures.
4. Future code uses TDD with memory VFS/memfs and mocked capabilities. Tests must not derive expected output from the implementation or invoke the native oracle. Keep engine unit tests separate from independent compatibility controls and CLI/SDK parity tests.
5. Prove cancellation and invocation cleanup on every exit, bounded input/decoder/DOM/attribute/depth/selector/matcher/mutation/output/retained-state accounting, realm ownership and replay invariants. No host executables, ambient files, implicit network or dynamic dependency downloads. Limit overrides may lower host ceilings only.
6. Wiring/publication gates verify opt-in composition, canonical shared brands without dependency cycles, installed ESM runtime and declarations via the public htmlq subpath, and zero escaped unpublished specifiers. Documentation alone passes none of these implementation gates.

## Behavior implementation comparison

A01–A40 now each pass separately named memory-byte-stream tests in
`packages/safe-bash-command-htmlq/src/compatibility.test.ts`. This closes only those
literal implementation comparisons; it does not change their source/native
research labels or establish full parser/selector/URL/writer parity. Reviewed
increments, failure-path evidence and remaining open cells are recorded in
[safe-bash-htmlq-behavior-review.md](safe-bash-htmlq-behavior-review.md).
