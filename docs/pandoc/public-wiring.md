# Public Pandoc SDK and explicit plugin

The root package exports `poe-code/pandoc` and
`poe-code/safe-bash/commands/pandoc`. Private workspace identities remain
`@poe-code/pandoc` and `virtual-bash`; consumers install only the root package.

```ts
import {convert, type ConversionOptions} from "poe-code/pandoc";
import {Shell, MemoryFileSystem} from "poe-code/safe-bash";
import {pandocCommands} from "poe-code/safe-bash/commands/pandoc";

const options: ConversionOptions = {from: "commonmark", to: "plain"};
const result = await convert([
  {bytes: new TextEncoder().encode("# Original\n")}
], options, {});

const shell = new Shell({fs: new MemoryFileSystem()});
try {
  shell.use(pandocCommands({limits: {inputBytes: 1_048_576}}));
  const output = await shell.exec("pandoc -f commonmark -t plain", {
    stdin: "# Original\n"
  });
} finally {
  await shell.dispose();
}
```

SDK conversion accepts explicit byte inputs and capability context. The plugin
adds only `pandoc` when registered; `agentCommands` is unchanged. Duplicate
registration fails before replacement unless `replace: true` is supplied.

Root bundling publishes a portable ESM graph for both converter entries. Shared
canonical filesystem contracts stay external through `poe-code/safe-fs/core`,
preserving runtime class identity. No private engine is loaded dynamically and no
native Pandoc or process fallback is supplied. The current built-in PPTX adapter
statically includes the presentation engine in ordinary text imports; the current
public graph test explicitly requires it. DOCX remains absent. Separate text-only
Office-bundle isolation is not delivered. EPUB shares archive/compression codecs with Office packages;
those shared codecs are included along with the converter's existing PDF support.
The original export change did not add Office format capabilities; the later
PPTX adapter now supplies bounded built-in read/write support. Historical
verification below predates it; see [the current acceptance audit](final-acceptance-audit.md).

Public declarations are included separately from runtime bundles. Unbundled
private Pandoc JavaScript is excluded from the root file inventory. Public unit
consumers inspect maintained build artifacts, copy the runtime graph into memfs,
resolve exports and types, convert original text, and exercise collision and
replacement through the real command registry. They do not invoke native build
executables. Graph checks reject native/dynamic imports, ambient fetch/require
calls and DOCX engine sources, and verify PPTX engine inclusion. These checks are not a host JavaScript
security boundary.

## Verification

Initial original checks reproduced missing public SDK export/type resolution and
missing portable SDK/plugin graph. Integration validation results are recorded
below after execution. No push or release is authorized.

- Selected closure: `npm run build:workspaces -- --workspace=virtual-bash` passed;
  task membership came from maintained declarations (8 builds in this run).
- Pandoc workspace lint/typecheck passed; package tests passed (932 original unit
  cases in 34 files).
- Full `npm run build` passed, including root publication policy.
- Full `npm run lint` passed: ESLint, type contracts and workflow lint.
- Focused public/package tests passed: 35 cases in three maintained test files.
  SDK types call conversion and reject native-engine options.
- Built public Node SDK/plugin/shell conversion, collision and replacement passed.
  SDK import and text conversion passed with ambient fetch denied before import.
- Converter graphs have only the canonical safe-fs core external import. A trace
  of the reachable canonical Node core imports found only async_hooks, crypto, os
  and util; no native filesystem, child_process or engine import.
- Dry-run npm inventory includes both runtime entries, declarations and the shared
  converter chunk (three JavaScript files); unbundled private Pandoc JS is absent.
- Isolated publication-stage type QA copied 56 reachable declarations into memfs,
  applied the maintained `rewriteWorkspaceDts`, and compiled SDK/plugin calls with
  strict declaration checking. Diagnostics: zero. The isolated package had no
  private workspace manifests or symlinks; ambient Node types came from tooling.
- Auxiliary `npm run lint:packages` failed: missing `packages/pandoc/README.md`
  and `packages/pdf/README.md`. No README additions are authorized by this task.
- Fresh full `npm test` has reported the missing untracked archived-plan input
  `docs/plans/archive/cli-aliasing.md` in the toolcraft-design frontmatter demo test.
  The converter-focused checks do not certify this failed integration gate.

Initial build attempts exposed a canonical filesystem duplication and root test
inventory drift; those wiring defects were corrected and the build/focused checks
rerun successfully. An invalidated first full-test run was stopped after artifact
and inventory failures and restarted after the successful build. A proposed faster
JavaScript import scan initially treated bundled AMD `exports` as a module import;
that scanner error was corrected by disabling AMD/CommonJS preprocessing. None of
those failed or stopped runs count as successful integration validation.
