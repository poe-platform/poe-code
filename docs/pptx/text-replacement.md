# Literal text replacement

The `pptx` workspace provides preserving literal replacement through the SDK operation `replacePresentationText` and command `pptx text replace`. These examples describe the workspace implementation; the package remains private and is not a published installation promise.

```text
pptx text replace deck.pptx --find "Coastal survey" --with "Harbor survey" --first --output updated.pptx
pptx text replace deck.pptx --find "draft" --with "final" --all --slide 2 --output updated.pptx --json
pptx text replace deck.pptx --find "draft" --with "" --occurrence 2 --dry-run --json
```

Exactly one of `--first`, `--all`, or `--occurrence N` is required. Occurrences are one-based, nonoverlapping matches counted across the selected scope in structural order. New replacement text is not searched again. The default scope is slides; `--all` does not implicitly include notes, layouts or masters.

Search is case-sensitive and literal. Punctuation such as `.` and replacement text such as `$&` have no special meaning. Unicode combining sequences are preserved without normalization: `é` and `é` are different searches. Emoji and other supplementary characters are matched without cutting surrogate pairs. Empty `--find`, malformed surrogate strings and characters forbidden by XML fail; empty `--with` deletes matching text.

A match can span adjacent runs inside one paragraph. Fields, soft line breaks, paragraphs, cells and shapes bound the supported ranges. Field caches are preserved. Replacement text inherits the first affected run's formatting; unmatched prefix/suffix formatting and hyperlinks remain intact. An explicit override affects only inserted text: use `--style-json '{"bold":true,"italic":false}'`, or SDK `style: { bold: true, italic: false }`. Omitted properties retain the first affected run's values; explicit `false` disables that property. Only `bold` and `italic` are accepted, and an override must contain at least one of them. Whole-object text assignment and resource text setters have their own destructive semantics.

Zero matches fail unless `--allow-empty` is explicit. The JSON result reports `operation: "text.replace"`, `affected` as the replacement count, and containing text-owner locations. Successful no-match allowance reports zero. Use `--output` or `--in-place` for publication, or `--dry-run` for inspection without publication. Existing common force, limits and selection protections apply.

For the SDK, supply admitted bytes and an explicit context containing input, archive, XML and relationship limits:

```typescript
import { replacePresentationText } from "pptx";

const result = await replacePresentationText(
  admittedBytes,
  { find: "Coastal survey", with: "Harbor survey", first: true },
  context
);
// The caller owns result.bytes and chooses an explicit output capability.
```

The operation does not read host files, fetch links or publish output implicitly. The CLI adapter invokes the same package behavior using its explicit read/publication capabilities. Discover actual option/result schemas with `pptx schema text replace --json` and implemented support with `pptx capabilities --json`.

Usage scope: this operation does not establish complete live-object model API coverage or rendered slide fidelity. Detailed provenance and remaining model obligations are in [the research accounting](text-replacement-accounting.json); validation procedures and evidence are in [the implementation plan](../plans/pptx-text-replacement.md).
