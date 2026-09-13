# Original pptx fixture usage

Three test-only expanded OPC decks are available in
`packages/pptx/tests/fixtures/decks.ts`. They are input primitives for the proposed
`pptx` implementation, not a public SDK or a command that produces `.pptx` files.
No ZIP archive or binary fixture is stored in the repository.

```ts
import { createDeckFixture } from "./fixtures/decks.js";

const { volume, root } = createDeckFixture("seed-library");
const slideXml = volume.readFileSync(`${root}/ppt/slides/slide1.xml`, "utf8");
const pictureBytes = volume.readFileSync(`${root}/ppt/media/tile.bmp`);
```

The import is relative to a future test in `packages/pptx/tests`. Each call creates
an independent memfs `Volume` rooted at `/deck`. The helper uses no environment
variables, filesystem capabilities outside that volume, current time, randomness,
network, product code or native process. Text and image bytes are authored here.

| Theme argument        | Slide title             | Chart categories and values |
| --------------------- | ----------------------- | --------------------------- |
| `seed-library`        | Seed library            | Beans: 12; Peas: 8          |
| `coastal-observatory` | Coastal observatory     | North: 3; South: 5          |
| `bicycle-workshop`    | Bicycle repair workshop | Tubes: 7; Wheels: 4         |

Each deck contains a blank master/layout, original theme, ordinary title text box,
body text in two nested groups, original 70-byte BMP, literal-data column chart
and a timing target. The slide is 9,144,000 by 6,858,000 EMUs. Both explicit core
timestamps are `2026-01-01T00:00:00Z`; they are fixture data, not creation defaults.

The optional second argument defaults to `valid`. Other values deliberately
produce one structural defect:

| Variant                  | Defect                                                 |
| ------------------------ | ------------------------------------------------------ |
| `missing-layout`         | Removes the layout XML while retaining its references  |
| `dangling-image`         | Points the picture relationship to a nonexistent image |
| `duplicate-shape-id`     | Gives picture and body text shape ID 5                 |
| `dangling-timing-target` | Points timing to nonexistent shape 999                 |
| `malformed-slide-xml`    | Omits the slide root's closing tag                     |

These fixtures have structural test evidence only, not renderer, playback or
full schema certification. They contain no embedded workbook and do not test
chart synchronization. The title is not a placeholder. Callers must add original
inputs for other API edge cases and author expected results independently of the
implementation being tested. Fixture helper exports do not establish any public
SDK or CLI coverage.

Verification procedure and recorded limitations are in
[the fixture plan](../plans/pptx-original-fixtures.md). Source-case provenance
and inventory identity checks are in
[the research receipt](original-fixture-evidence.json).
