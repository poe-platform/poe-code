# Format registry verification

Verified on 2026-09-16 in the original TypeScript converter.

Original failing-first coverage: six registry tests initially failed (missing
registry exports and rejected GFM switches); two inspection tests initially
failed (missing SDK/adapter exports). Further failing cases reproduced
extensionless suffix inference, output-only extension inspection, and HTML alias
capability reporting. Final package suite: 91 tests passed across five files.

Maintained checks passed:

- `npm test --workspace=@poe-code/pandoc`
- `npm run lint --workspace=@poe-code/pandoc` (ESLint and source/test type checks)
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`

The selected workspace build used maintained discovery and dependency closure;
no runtime filesystem scanning was added. Unit tests used original in-memory
values and mocks, with no filesystem mutations, native executables, downloads or
LLM calls. No memfs dependency was needed because these tests perform no file I/O.

The registry derives names, directional aliases, permitted/available directions,
media, suffix inference, extension defaults, toggles and option applicability
from statically imported format modules. The coordinator resolves readers and
writers through registry lookups and passes canonical selections to callbacks.
`markdown` remains rejected. GFM toggles apply left to right, including repeated
and disabled switches. Listings are sorted independently of module order.
Office injection advertises only the explicitly supplied allowed direction.

`inspectFormats` handles the three listing flags without I/O.
`createFormatInspectionCommand` is a structurally compatible opt-in safe-bash
command adapter exported by pandoc; it only handles registry inspection. It is
not installed in default safe-bash command families. Full conversion command
parsing/wiring and actual format codecs remain separate converter tasks.
All core built-in readers/writers remain unavailable; descriptors describe the
contract without claiming codec conformance or using a native fallback.

Visual QA used the maintained screenshot tool on built SDK listing output.
The tool initially required building its terminal-png workspace dependency;
after that build, capture and image inspection succeeded. The screenshot shows
sorted extension names with the disabled task-list switch explicitly prefixed
with minus: [format-registry.png](format-registry.png).
