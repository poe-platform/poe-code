# Theme and background editing

Draft usage for the `pptx` workspace package. This covers the byte SDK and command operations; the complete live presentation object model remains incomplete.

Use `readThemes(input, context)` to inspect palette/font values and theme overrides without changing the package. `mutateTheme(input, options, context)` requires `scope: "shared"` and the exact theme part URI. Pair `colorSlot` with a six-digit RGB `color`, and `fontSlot` with a `font` string. The result contains new package bytes and one-based `affectedSlides`; unrelated slide XML stays unchanged.

```typescript
const themes = await readThemes(inputBytes, context);
const result = await mutateTheme(
  inputBytes,
  {
    scope: "shared",
    theme: themes[0].part,
    colorSlot: "dk1",
    color: "101820",
    fontSlot: "majorLatin",
    font: "Aptos Display"
  },
  context
);
```

Palette slots are `dk1`, `lt1`, `dk2`, `lt2`, `accent1` through `accent6`, `hlink` and `folHlink`. Font slots are `majorLatin`, `minorLatin`, `majorEastAsia`, `minorEastAsia`, `majorComplex` and `minorComplex`. An override is edited by selecting its own part; a base theme edit does not flatten or erase override definitions. Unsupported theme payloads and extended effect lists are retained. Override parts cannot be renamed. A color-kind conversion with unsupported attributes or child payloads fails before publication.

```bash
pptx themes list slides.pptx --json
pptx themes set slides.pptx --scope shared --slide 1 --color-slot dk1 --color 101820 --in-place
pptx themes set slides.pptx --scope shared --slide 1 --font-slot majorLatin --font 'Aptos Display' --in-place
pptx backgrounds set slides.pptx --slide 1 --kind solid --color F8F4EC --output updated.pptx
pptx backgrounds set slides.pptx --slide 1 --kind gradient --stops '[{"position":0,"color":"101820"},{"position":1,"color":"E8F0F2"}]' --angle 90 --in-place
pptx backgrounds set slides.pptx --slide 1 --kind picture --file background.png --in-place
pptx backgrounds set slides.pptx --slide 1 --kind style-reference --style-index 1001 --style-color 205060 --in-place
pptx backgrounds set slides.pptx --slide 1 --kind inherit --in-place
```

`readBackgrounds(input, {scope}, context)` reads explicit definitions without creating a fill. `mutateBackground(input, options, context)` takes the exact owner `part` and `scope` (`slides`, `layouts` or `masters`). A slide edit changes one definition. Layout/master edits require the corresponding explicit shared-owner scope and report their dependent slides, including slides with retained local overrides. This dependency report is separate from directly affected object counts.

```typescript
const result = await mutateBackground(
  inputBytes,
  {
    scope: "slides",
    part: "/ppt/slides/slide1.xml",
    kind: "solid",
    color: "F8F4EC"
  },
  context
);
```

Solid fills require `color`; gradients require ordered stops with positions from zero to one, six-digit colors and optional opacity from zero to one. `angle` uses clockwise degrees normalized modulo 360 and defaults to zero. Picture support is bounded PNG/JPEG byte admission, without rendering or transcoding. Picture edits require explicitly supplied `image` bytes in the byte SDK; the command resolves `--file` only through its configured virtual filesystem. Style references require `styleIndex` and `styleColor`, and reference an existing applicable theme fill entry without copying that style into the slide. `inherit` accepts no fill payload. Inactive or unknown fields fail.

Unknown background effects survive supported fill edits. An operation that would discard unsupported payloads fails before publication. Missing image resources and invalid style references leave the input and output destination untouched. These operations do not calculate contrast ratios or promise renderer-equivalent appearance; palette changes can affect text using theme colors, so inspect the resulting effective text styles and the intended presentation appearance.

Commands expose the same operation schemas through `pptx schema` and supported subsets through `pptx capabilities`. Use `--dry-run --json` for validation and affected-owner reporting without publication. Mutations require `--in-place` or `--output`; replacing an existing distinct output requires `--force`. CLI positions are one-based. SDK calls require an explicit bounded context and do not discover host files, fonts, time or network resources.
