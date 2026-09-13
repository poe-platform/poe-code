import { addShapePath, setShapePath, readShapePaths } from "./shape-path-operations.js";
import { validateShapePath, pathFromVertices, type ShapePath } from "./shape-paths.js";
import { readFields, mutateFields, validateFieldOptions, type FieldUpdate } from "./fields.js";
import { fieldSchemas } from "./fields-schema.js";
import { addShape, mutateShapes, readShapes, type ShapeSelection } from "./shape-operations.js";
import { groupShapes, ungroupShape, validateGroupOptions } from "./shape-groups.js";
import {
  mutateShapeSelection,
  validateShapeSelectionOptions,
  type ShapeSelectionOptions
} from "./shape-selection.js";
import { Emu } from "./length.js";
import { validateShapeOptions, type ShapeUpdate } from "./shapes.js";
import { fitTextFrames, validateTextFitOptions, type TextFitOptions } from "./text-fitting.js";
import { admitFontMetrics } from "./font-metrics.js";
import {
  readTextFrames,
  mutateTextFrames,
  validateTextFrameOptions,
  type MutateTextFramesOptions
} from "./text-frames.js";
import {
  readTextParagraphs,
  mutateTextParagraphs,
  validateTextParagraphOptions,
  type MutateTextParagraphsOptions
} from "./text-paragraphs.js";
import {
  readTextRuns,
  mutateTextRuns,
  validateTextRunOptions,
  type MutateTextRunsOptions
} from "./text-runs.js";
import {
  readThemes,
  mutateTheme,
  themeColorSlots,
  themeFontSlots,
  type MutateThemeOptions
} from "./themes.js";
import { readBackgrounds, mutateBackground, type MutateBackgroundOptions } from "./backgrounds.js";
import { replacePresentationText } from "./text-replacement.js";
import { readPresentationText, type TextScope } from "./text-reading.js";
import { OfficeError } from "./errors.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { packageUri, partName } from "./package-uri.js";
import {
  SelectionError,
  decodeSelectionToken,
  readSelectionIndex,
  type SelectionContext,
  type SelectionQuery,
  type SelectionRecord
} from "./selectors.js";
import type { Diagnostic, Location, OfficeResult, Scope } from "./contracts.js";
import {
  masterSchemas,
  shapeSchemas,
  membershipSchemas,
  settingsSchemas,
  createSchema,
  inspectSchema,
  textGetSchema,
  textReplaceSchema,
  textFramesSetSchema,
  textFitSchema,
  textFramesGetSchema,
  textFramesListSchema,
  textParagraphsSetSchema,
  textParagraphsGetSchema,
  textParagraphsListSchema,
  textRunsSetSchema,
  textRunsGetSchema,
  textRunsListSchema,
  slidesAddSchema,
  slidesMoveSchema,
  slidesDuplicateSchema,
  slidesImportSchema,
  slidesMergeSchema,
  slidesSplitSchema,
  slidesRemoveSchema,
  slidesSetSchema,
  xmlGetSchema,
  xmlSetSchema
} from "./command-schema.js";
import { addMaster, mutateMaster, mutateMasterShape, readMasters } from "./masters.js";
import {
  readLayouts,
  addLayout,
  mutateLayout,
  removeLayout,
  applyLayout,
  type LayoutPlaceholder
} from "./layouts.js";
import { createPresentation, type CreatePresentationOptions } from "./creation.js";
import {
  addSlide,
  mutateSlides,
  type MutateSlidesOptions,
  type AddSlideOptions
} from "./slides.js";
import { commandJson, commandLength, commandTimestamp } from "./command-engine-values.js";
import { duplicateSlides } from "./slide-copy.js";
import { importSlides, type ImportSlidesOptions } from "./slide-import.js";
import { mergeSelectedDecks, splitSelectedDecks } from "./slide-merge-split.js";
import { SlideTransferBudget } from "./slide-transfer-budget.js";
import { readMemberships, mutateMemberships, type MembershipRecord } from "./memberships.js";
import { removeSlides } from "./slide-removal.js";
import {
  readPresentationSettings,
  mutatePresentationSettings,
  type MutatePresentationSettingsOptions
} from "./presentation-settings.js";
import { getXmlPart, replaceXmlPart } from "./xml-parts.js";
import type { ValidationLimits } from "./validation.js";

export interface PptxCommandEngineOptions {
  readonly context: Omit<SelectionContext, "signal"> & {
    readonly validationLimits?: ValidationLimits;
  };
  readonly maxArgumentBytes: number;
  readonly maxOutputBytes: number;
}
export interface PptxPublicationRequest {
  readonly inputPath?: string;
  readonly protectedInputPaths?: readonly string[];
  readonly outputPath: string;
  readonly bytes: Uint8Array;
  readonly originalBytes: Uint8Array;
  readonly inPlace: boolean;
  readonly force: boolean;
  readonly dryRun: boolean;
}
export interface PptxCommandRequest {
  readonly publishOutput?: (publication: PptxPublicationRequest) => Promise<void>;
  readonly preflightOutput?: (publication: PptxPublicationRequest) => Promise<void>;
  /** Trusted adapter transaction: either every requested file is published or none is. */
  readonly publishOutputs?: (publications: readonly PptxPublicationRequest[]) => Promise<void>;
  readonly args: readonly Uint8Array[];
  readonly signal: AbortSignal;
  readonly readInput: (path: string, maxBytes: number) => Promise<Uint8Array>;
}
export interface PptxCommandOutput {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}
export interface PptxCommandEngine {
  execute(request: PptxCommandRequest): Promise<PptxCommandOutput>;
}

const scopes: readonly Scope[] = [
  "slides",
  "notes",
  "layouts",
  "masters",
  "notes-master",
  "handout-master",
  "presentation",
  "shared"
];
const frameHelp =
  "Usage: pptx text frames list|get|set INPUT [selection] [formatting] [output]\n" +
  "Selection: --slide N --shape NAME --select TOKEN --scope SCOPE; --all (set only)\n" +
  "Shape text frames only; table cells are excluded. Read anchor just/dist is preserved metadata.\n" +
  "Formatting: --margin-left LENGTH --margin-right LENGTH --margin-top LENGTH --margin-bottom LENGTH\n" +
  "  --vertical-anchor top|middle|bottom --columns 1..16 --wrap true|false\n" +
  "  --vertical-text horz|vert|vert270|wordArtVert|eaVert|mongolianVert|wordArtVertRtl\n" +
  "  --rotation DEGREES --autofit none|shape|text --text TEXT\n" +
  "Lengths require emu/in/cm/mm/pt; SDK lengths use points. Null clears direct metadata.\n" +
  "Autofit writes metadata only; no font measurement or text fitting is performed.\n" +
  "Output: --output PATH | --in-place; --force --dry-run --json --allow-empty\n";
const paragraphHelp =
  "Usage: pptx text paragraphs list|get|set INPUT [selection] [formatting] [output]\n" +
  "Selection: --slide N --shape NAME --paragraph N (one-based), --select TOKEN, --all (set only)\n" +
  "Formatting: --alignment left|center|right|justify|justifyLow|distributed|thaiDistributed\n" +
  "  --margin-left LENGTH --margin-right LENGTH --indent LENGTH --default-tab-size LENGTH\n" +
  "  --space-before LENGTH --space-after LENGTH --line-spacing MULTIPLE_OR_LENGTH\n" +
  "  --level 0..8 --direction ltr|rtl|null --rtl true|false|null\n" +
  "  --bullet CHARACTER_OR_JSON --numbering decimal|lower-alpha|upper-alpha|lower-roman|upper-roman|none|null\n" +
  "  --tabs JSON (Length records, or position in points with alignment)\n" +
  "Lengths require emu/in/cm/mm/pt; numeric JSON positions and SDK lengths use points.\n" +
  "Omitted properties remain unchanged; null clears overrides. No line wrapping is calculated.\n" +
  "Output: --output PATH | --in-place; --force --dry-run --json --allow-empty\n";
const runHelp =
  "Usage: pptx text runs list|get INPUT [selection] [--json]\n" +
  "       pptx text runs set INPUT [selection] [formatting] [output]\n\n" +
  "Selection: --slide N --shape NAME --paragraph N --run N (one-based)\n" +
  "           --select TOKEN, or --all for every run in scope\n" +
  "           --scope SCOPE --allow-empty (set only)\n" +
  "Formatting: --font NAME --size LENGTH --language TAG\n" +
  "Script fonts: --east-asia-font NAME --complex-script-font NAME --symbol-font NAME\n" +
  "              --complex-script-charset N --complex-script-pitch-family N\n" +
  "              --complex-script-panose HEX (20 digits)\n" +
  "              --alternate-language TAG --rtl true|false|null\n" +
  "            --bold true|false|null --italic true|false|null\n" +
  "            --underline STYLE --strike none|single|double\n" +
  "            --baseline PERCENT --capitalization none|small|all\n" +
  "            --spacing LENGTH --color COLOR --highlight COLOR --text TEXT\n" +
  "Omitted formatting is unchanged; null clears an explicit override.\n" +
  "Colors: six hex digits or JSON with rgb/theme and optional brightness.\n" +
  "Lengths: emu, in, cm, mm, pt. List returns all matches; get requires one.\n" +
  "Output: --output PATH | --in-place; --force --dry-run --json\n" +
  "Use pptx schema text runs set --json for complete option definitions.\n";
const help =
  "Usage: pptx create --output PATH [--kind pptx|potx|ppsx] [--width LENGTH]\n" +
  "                   [--height LENGTH] [--slides-json JSON] [--author TEXT]\n" +
  "                   [--properties-json JSON] [--dialect transitional]\n" +
  "                   [--timestamp UTC] [--force] [--dry-run] [--json]\n" +
  "       pptx inspect INPUT [--slide N] [--shape NAME] [--all] [--json]\n" +
  "       pptx inspect INPUT --part URI [--scope SCOPE] [--json]\n" +
  "       pptx inspect INPUT --select TOKEN [--json]\n" +
  "       pptx slides add INPUT --layout LAYOUT [--position N] [--name TEXT]\n" +
  "                       [--title TEXT] [--body TEXT] [--placeholders-json JSON]\n" +
  "                       [--hidden true|false] [--follow-master-background true|false]\n" +
  "                       [--output PATH | --in-place] [--force] [--dry-run] [--json]\n" +
  "       pptx slides remove INPUT [--slide N | --select TOKEN | --all]\n" +
  "                       [--reference-policy remove] [--allow-empty]\n" +
  "                       [--output PATH | --in-place] [--force] [--dry-run] [--json]\n" +
  "       pptx slides duplicate INPUT --position N [--slide N | --select TOKEN | --all]\n" +
  "                       [--allow-empty] [--output PATH | --in-place] [--force] [--dry-run] [--json]\n" +
  "       pptx slides import INPUT --source PATH --source-slides JSON [--position N]\n" +
  "                       [--theme-policy source|destination] [--dimension-policy reject|destination]\n" +
  "                       [--output PATH | --in-place] [--force] [--dry-run] [--json]\n" +
  "       pptx slides merge INPUT --sources JSON --theme-policy source|destination\n" +
  "                       [--source-slides JSON] [--dimension-policy reject|destination]\n" +
  "                       [--output PATH | --in-place] [--force] [--dry-run] [--json]\n" +
  "       pptx slides split INPUT --slides JSON [--output-dir DIR]\n" +
  "                       [--allow-partial-output] [--force] [--dry-run] [--json]\n" +
  "       pptx slides move INPUT --position N [--slide N | --select TOKEN | --all]\n" +
  "                       [--allow-empty] [--output PATH | --in-place] [--force] [--dry-run] [--json]\n" +
  "       pptx slides set INPUT [--name TEXT] [--hidden true|false] [--position N]\n" +
  "                       [--slide N | --select TOKEN | --all] [--allow-empty]\n" +
  "                       [--output PATH | --in-place] [--force] [--dry-run] [--json]\n" +
  "       pptx text fit INPUT --metrics JSON [--min-size N --max-size N] [selection] [output]\n" +
  "       pptx text frames list|get|set INPUT [--vertical-anchor top|middle|bottom] [--autofit none|shape|text]\n" +
  "       pptx text paragraphs list|get|set INPUT [--paragraph N] [--alignment left|center|right] [--json]\n" +
  "       pptx text get INPUT [--slide N] [--shape NAME] [--scope SCOPE] [--json]\n" +
  "       pptx text runs set INPUT --slide N --shape NAME --font NAME --size 18pt --output PATH\n" +
  "       pptx text replace INPUT --find TEXT --with TEXT --first|--all|--occurrence N\n" +
  "                         [--slide N --shape NAME | --select TOKEN] [--scope SCOPE]\n" +
  "                         [--style-json JSON] [--allow-empty] [--dry-run] [--output PATH | --in-place] [--force] [--json]\n" +
  "       pptx text INPUT | pptx text get INPUT --select TOKEN [--json]\n" +
  "       pptx schema text get [--json]\n" +
  "       Text uses structural shape-tree order, including hidden slides, cached fields and empty paragraphs.\n" +
  "       Text --slide follows notes/layout/master owners within the explicit scope.\n" +
  "       Text notes-master/handout-master scopes are deck-level and reject --slide.\n" +
  "       pptx xml get INPUT --part URI [--scope SCOPE] [--pretty] [--json]\n" +
  "       pptx xml set INPUT --part URI --file XML [--scope SCOPE]\n" +
  "                    [--output PATH | --in-place] [--force] [--dry-run] [--json]\n" +
  "       pptx schema [create | inspect | slides add | slides move | slides set |\n" +
  "                    slides remove | slides duplicate | slides import |\n" +
  "                    slides merge | slides split | xml get | xml set] [--json]\n" +
  "       pptx schema sections|shows list|get|add|set|remove [--json]\n" +
  "       pptx sections|shows list|get INPUT [--select TOKEN | --slide N] [--json]\n" +
  "       pptx sections|shows add INPUT --name TEXT --slides JSON [--position N]\n" +
  "       pptx sections|shows set INPUT [--name TEXT] [--slides JSON] [--position N]\n" +
  "       pptx sections|shows remove INPUT [--select TOKEN | --slide N | --all]\n" +
  "                       [--output PATH | --in-place] [--dry-run] [--json]\n" +
  "       pptx masters list|get INPUT [--part URI | --slide N | --select TOKEN] [--json]\n" +
  "       pptx masters add INPUT --scope masters|shared --name TEXT [--text TEXT] [--theme URI]\n" +
  "       pptx masters set INPUT --scope masters|shared [--part URI | --slide N | --select TOKEN]\n" +
  "                        [--name TEXT] [--shape NAME --text TEXT] [--all] [--allow-empty]\n" +
  "       pptx layouts list|get INPUT [--part URI | --slide N | --select TOKEN] [--json]\n" +
  "       pptx layouts add INPUT --scope layouts|shared --name TEXT --master NAME_OR_URI [--placeholders-json JSON]\n" +
  "       pptx layouts set INPUT --scope layouts|shared [--part URI | --slide N | --select TOKEN] [--name TEXT] [--master NAME_OR_URI]\n" +
  "                        [--shape NAME --text TEXT] [--type TYPE] [--preserve true|false]\n" +
  "                        [--show-master-shapes true|false] [--matching-name TEXT]\n" +
  "       pptx layouts remove INPUT --scope layouts|shared [--part URI | --select TOKEN | --all]\n" +
  "       pptx layouts apply INPUT [--slide N | --select TOKEN | --all] --layout NAME_OR_URI\n" +
  "                          --placeholder-policy type-index|reject-unmatched\n" +
  "       pptx shapes list|get INPUT [--slide N --shape NAME] [--scope SCOPE] [--json]\n" +
  "       pptx shapes group INPUT --shapes LOCATIONS_JSON --tolerance LENGTH [output]\n" +
  "       pptx shapes ungroup INPUT [selection] --tolerance LENGTH [output]\n" +
  "       pptx shapes move|align|distribute|duplicate INPUT [selection] --coordinate-system slide|group [options] [output]\n" +
  "       pptx shapes paths list|get|add|set INPUT [selection] [--path JSON]\n" +
  "       pptx shapes add INPUT --slide N --kind text-box|PRESET\n" +
  "                       --left LENGTH --top LENGTH --width LENGTH --height LENGTH [--name TEXT] [--text TEXT]\n" +
  "       pptx shapes set INPUT --slide N --shape NAME [--scope SCOPE]\n" +
  "                       [--name TEXT] [--text TEXT] [--left LENGTH] [--top LENGTH] [--width LENGTH] [--height LENGTH]\n" +
  "       pptx themes list|get INPUT [--slide N | --part URI | --select TOKEN] [--json]\n" +
  "       pptx themes set INPUT --scope shared [--slide N | --part URI | --select TOKEN]\n" +
  "                       [--name TEXT] [--color-slot SLOT --color RRGGBB] [--font-slot SLOT --font TEXT]\n" +
  "       pptx backgrounds list|get INPUT [--slide N | --part URI] [--scope SCOPE] [--json]\n" +
  "       pptx backgrounds set INPUT [--slide N | --part URI | --select TOKEN] [--scope SCOPE]\n" +
  "                       --kind solid --color RRGGBB | --kind gradient --stops JSON [--angle N]\n" +
  "                       --kind picture --file PATH | --kind inherit\n" +
  "                       --kind style-reference --style-index N --style-color RRGGBB\n" +
  "       Shared mutations: [--output PATH | --in-place] [--force] [--dry-run] [--json]\n" +
  "       pptx schema masters list|get|add|set | layouts list|get|add|set|remove|apply | shapes list|get|add|set|group|ungroup | backgrounds set [--json]\n" +
  "       pptx capabilities [--json]\n" +
  "       pptx settings list|get INPUT [--json]\n" +
  "       pptx settings set INPUT [--width LENGTH] [--height LENGTH]\n" +
  "                    [--orientation portrait|landscape] [--notes-width LENGTH]\n" +
  "                    [--notes-height LENGTH] [--notes-orientation portrait|landscape]\n" +
  "                    [--slide-number-start N] [--loop true|false]\n" +
  "                    [--show-type speaker|window|kiosk] [--scale-content true|false]\n" +
  "                    [--output PATH | --in-place] [--force] [--dry-run] [--json]\n" +
  "       pptx schema settings list|get|set [--json]\n" +
  "Settings resize the canvas only by default. Explicit content scaling rejects unsupported transforms.\n" +
  "Slide positions are one-based. Shape names are exact; numeric strings are names.\n" +
  "Duplicate names require --all. Default scope: slides.\n" +
  "Scopes: slides, notes, layouts, masters, notes-master, handout-master,\n" +
  "        presentation, shared.\n" +
  "Use --json to obtain reusable fingerprinted selector tokens.\n" +
  "XML operations also accept --select TOKEN instead of --part/--scope.\n" +
  "XML get reads package metadata with --part URI --scope shared.\n" +
  "Input '-' reads stdin; '--' ends options. Output - writes package bytes.\n" +
  "--limit NAME=VALUE lowers maxBytes, maxNodes, maxDepth or maxOutputBytes.\n" +
  "Repeat --limit for distinct names; output requires at least 512 bytes.\n" +
  "XML get emits original bytes; --pretty labels formatted output.\n" +
  "XML set validates before publication; element structure and resource bindings\n" +
  "must remain unchanged. Semantic checks are partial, not full schema validation.\n" +
  "Create defaults: empty deck, 12192000 x 6858000 EMUs, blank layout and master.\n" +
  "Lengths require emu, in, cm, mm or pt. Dates/authors are never synthesized.\n" +
  "Create supports Transitional only; supplied templates are unavailable.\n" +
  "Slides move/set/remove/duplicate also accept --selection-json QUERY_OR_ARRAY instead of simple selectors.\n" +
  "Section/show memberships are pruned automatically on slide removal.\n" +
  "Other affected known references require --reference-policy remove; opaque targets are rejected.\n" +
  "Import source-slides is an ordered JSON array of unique one-based positions.\n" +
  'Merge sources use --sources \'[{"vfsPath":"source.pptx"}]\'.\n' +
  "Merge applies source-slides to each source, or imports all when omitted.\n" +
  "Split names slide-NNNNNN.pptx follow emitted order; outward slide links fail.\n" +
  "Split requires an atomic adapter or explicit --allow-partial-output.\n" +
  "Import preserves source appearance by default; destination theme mapping is unavailable.\n" +
  "Import rejects conflicting notes masters, global font/text/table-style dependencies, unselected slide links and opaque references.\n" +
  "Dimension conflicts reject by default; destination policy retains source coordinates and destination size.\n" +
  "Slides add requires an exact layout name or part URI; position defaults to append.\n" +
  "Title/body match placeholder types; indexed bindings use --placeholders-json.\n";

interface Arguments {
  selectionEdit?: ShapeSelectionOptions;
  shapes?: readonly Location[];
  tolerance?: Emu;
  path?: ShapePath;
  vertices?: unknown;
  close?: boolean;
  shapeEdit?: ShapeUpdate;
  fieldEdit?: FieldUpdate;
  operation:
    | `fields.${"list" | "get" | "set" | "add" | "remove"}`
    | `masters.${"list" | "get" | "add" | "set"}`
    | `layouts.${"list" | "get" | "add" | "set" | "remove" | "apply"}`
    | "shapes.paths.list"
    | "shapes.paths.get"
    | "shapes.paths.add"
    | "shapes.paths.set"
    | "shapes.add"
    | "shapes.set"
    | "shapes.list"
    | "shapes.get"
    | "shapes.group"
    | "shapes.ungroup"
    | "shapes.move"
    | "shapes.align"
    | "shapes.distribute"
    | "shapes.duplicate"
    | `backgrounds.${"list" | "get" | "set"}`
    | `themes.${"list" | "get" | "set"}`
    | `settings.${"list" | "get" | "set"}`
    | `sections.${"list" | "get" | "add" | "set" | "remove"}`
    | `shows.${"list" | "get" | "add" | "set" | "remove"}`
    | "create"
    | "slides.add"
    | "slides.move"
    | "slides.set"
    | "slides.remove"
    | "slides.duplicate"
    | "slides.import"
    | "slides.merge"
    | "slides.split"
    | "text.get"
    | "text.replace"
    | "text.fit"
    | "text.frames.set"
    | "text.frames.get"
    | "text.frames.list"
    | "text.paragraphs.set"
    | "text.paragraphs.get"
    | "text.paragraphs.list"
    | "text.runs.set"
    | "text.runs.get"
    | "text.runs.list"
    | "inspect"
    | "xml.get"
    | "xml.set"
    | "schema"
    | "capabilities"
    | "help"
    | "version";
  layoutEdit?: {
    layout?: string;
    placeholderPolicy?: "type-index" | "reject-unmatched";
    type?: string;
    preserve?: boolean;
    showMasterShapes?: boolean;
    matchingName?: string;
    placeholders?: readonly LayoutPlaceholder[];
  };
  themeEdit?: Partial<MutateThemeOptions>;
  backgroundEdit?: Partial<MutateBackgroundOptions>;
  masterEdit?: {
    name?: string;
    text?: string;
    theme?: string;
    master?: string;
    kind?: string;
    color?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  membership?: { name?: string; slides?: readonly number[]; position?: number };
  settings?: MutatePresentationSettingsOptions;
  creation?: CreatePresentationOptions;
  addition?: Partial<AddSlideOptions>;
  mutation?: Omit<MutateSlidesOptions, "selection">;
  importing?: Partial<ImportSlidesOptions>;
  source?: string;
  sources?: readonly string[];
  splitSlides?: readonly number[];
  outputDir?: string;
  allowPartialOutput?: boolean;
  allowEmpty?: boolean;
  referencePolicy?: "remove";
  selection?: SelectionQuery | readonly SelectionQuery[];
  template?: string;
  runEdit?: MutateTextRunsOptions;
  frameEdit?: MutateTextFramesOptions;
  fitEdit?: TextFitOptions;
  paragraphEdit?: MutateTextParagraphsOptions;
  style?: { bold?: boolean; italic?: boolean };
  first?: boolean;
  occurrence?: number;
  find?: string;
  with?: string;
  pretty?: boolean;
  file?: string;
  output?: string;
  inPlace?: boolean;
  force?: boolean;
  dryRun?: boolean;
  schemaPath?: string;
  limits?: Record<string, number>;
  json: boolean;
  input?: string;
  slide?: number;
  shape?: string;
  part?: string;
  token?: string;
  scope?: Scope;
  all?: boolean;
}

function usage(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}

function paragraphTabLength(length: Record<string, unknown>): number {
  if (
    Object.keys(length).some((key) => !["value", "unit"].includes(key)) ||
    typeof length.value !== "number" ||
    !Number.isFinite(length.value) ||
    length.value < 0 ||
    typeof length.unit !== "string"
  )
    usage("Tabs require finite explicit lengths.");
  const emu = length.value * commandLength("1" + length.unit, 0);
  if (!Number.isFinite(emu) || emu > Number.MAX_SAFE_INTEGER)
    usage("Tab length is outside the supported range.");
  return Math.round(emu) / 12700;
}

const runFlags = [
  "--complex-script-charset",
  "--complex-script-pitch-family",
  "--complex-script-panose",
  "--east-asia-font",
  "--complex-script-font",
  "--symbol-font",
  "--alternate-language",
  "--rtl",
  "--text",
  "--font",
  "--size",
  "--language",
  "--bold",
  "--italic",
  "--underline",
  "--strike",
  "--baseline",
  "--capitalization",
  "--spacing",
  "--color",
  "--highlight",
  "--paragraph",
  "--run"
];

const paragraphFlags = [
  "--direction",
  "--numbering",
  "--paragraph",
  "--alignment",
  "--margin-left",
  "--margin-right",
  "--indent",
  "--default-tab-size",
  "--space-before",
  "--space-after",
  "--line-spacing",
  "--level",
  "--rtl",
  "--bullet",
  "--tabs"
];

const fitFlags = [
  "--metrics",
  "--font-family",
  "--min-size",
  "--max-size",
  "--bold",
  "--italic",
  "--wrap",
  "--line-spacing",
  "--margin-left",
  "--margin-right",
  "--margin-top",
  "--margin-bottom"
];
const frameFlags = [
  "--text",
  "--margin-left",
  "--margin-right",
  "--margin-top",
  "--margin-bottom",
  "--vertical-anchor",
  "--columns",
  "--wrap",
  "--vertical-text",
  "--rotation",
  "--autofit"
];

const scalarOptions = [
  "--flip-horizontal",
  "--flip-vertical",
  "--title",
  "--description",
  "--alt-text",
  "--locked",
  "--fill",
  "--line-color",
  "--line-width",
  ...fitFlags,
  ...frameFlags,
  ...paragraphFlags,
  ...runFlags,
  "--path",
  "--vertices",
  "--close",
  "--style-json",
  "--find",
  "--with",
  "--occurrence",
  "--color-slot",
  "--font-slot",
  "--font",
  "--stops",
  "--angle",
  "--style-index",
  "--style-color",
  "--type",
  "--preserve",
  "--show-master-shapes",
  "--matching-name",
  "--placeholder-policy",
  "--text",
  "--theme",
  "--master",
  "--color",
  "--left",
  "--top",
  "--scale-content",
  "--notes-width",
  "--notes-height",
  "--orientation",
  "--notes-orientation",
  "--slide-number-start",
  "--loop",
  "--show-type",
  "--sources",
  "--slides",
  "--output-dir",
  "--source",
  "--source-slides",
  "--theme-policy",
  "--dimension-policy",
  "--reference-policy",
  "--selection-json",
  "--slide",
  "--shape",
  "--shapes",
  "--coordinate-system",
  "--order",
  "--axis",
  "--offset-x",
  "--offset-y",
  "--tolerance",
  "--part",
  "--select",
  "--scope",
  "--file",
  "--output",
  "-o",
  "--limit",
  "--width",
  "--height",
  "--kind",
  "--dialect",
  "--template",
  "--timestamp",
  "--author",
  "--slides-json",
  "--properties-json",
  "--layout",
  "--position",
  "--name",
  "--hidden",
  "--follow-master-background",
  "--title",
  "--body",
  "--placeholders-json"
];

function parse(
  raw: readonly Uint8Array[],
  maximum: number,
  output: { operation: string; json: boolean }
): Arguments {
  const args: string[] = [];
  let size = 0;
  let hintOptions = true;
  let hintValue = false;
  let invalidUtf8 = false;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  for (let index = 0; index < raw.length; index++) {
    const bytes = raw[index]!;
    if (!(bytes instanceof Uint8Array)) usage("Arguments must be byte arrays.");
    size += bytes.length + 1;
    if (size > maximum) {
      if (invalidUtf8) usage("Arguments must be UTF-8.");
      throw new OfficeError("resource-limit", "Argument limit exceeded.", "usage");
    }
    try {
      args.push(decoder.decode(bytes));
    } catch {
      invalidUtf8 = true;
      args.push("");
    }
    const argument = args[index]!;
    if (index === 0) {
      const command =
        argument === "--help" || argument === "-h"
          ? "help"
          : argument === "--version"
            ? "version"
            : argument;
      if (command === "text") output.operation = "text.get";
      if (["create", "inspect", "schema", "capabilities", "help", "version"].includes(command))
        output.operation = command;
    } else if (index === 1 && args[0] === "text" && ["get", "replace", "fit"].includes(argument)) {
      output.operation = `text.${argument}`;
    } else if (index === 1 && args[0] === "xml" && ["get", "set"].includes(argument)) {
      output.operation = `xml.${argument}`;
    } else if (
      index === 1 &&
      args[0] === "slides" &&
      ["add", "move", "set", "remove", "duplicate", "import", "merge", "split"].includes(argument)
    ) {
      output.operation = `slides.${argument}`;
    } else if (
      index === 1 &&
      ["sections", "shows", "masters", "layouts", "shapes", "backgrounds", "themes"].includes(
        args[0]!
      ) &&
      [
        "list",
        "get",
        "add",
        "set",
        "remove",
        "apply",
        "group",
        "ungroup",
        "move",
        "align",
        "distribute",
        "duplicate"
      ].includes(argument)
    ) {
      output.operation = `${args[0]}.${argument}`;
    } else if (index === 1 && args[0] === "settings" && ["list", "get", "set"].includes(argument)) {
      output.operation = `settings.${argument}`;
    } else if (hintValue) hintValue = false;
    else if (hintOptions) {
      if (argument === "--") hintOptions = false;
      else if (argument === "--json") output.json = true;
      else if (scalarOptions.includes(argument)) hintValue = true;
    }
  }
  if (invalidUtf8) usage("Arguments must be UTF-8.");
  if (
    args[0] === "text" &&
    ["runs", "paragraphs", "frames"].includes(args[1]!) &&
    ["get", "set", "list"].includes(args[2]!)
  ) {
    const path = `text.${args[1]}.${args[2]}`;
    args.splice(0, 3, path);
    output.operation = path;
  }
  if (
    args[0] === "shapes" &&
    args[1] === "paths" &&
    ["add", "set", "list", "get"].includes(args[2]!)
  ) {
    const path = `shapes.paths.${args[2]}`;
    args.splice(0, 3, path);
    output.operation = path;
  }
  if (args[0] === "text" && !["get", "replace", "fit"].includes(args[1]!)) args.splice(1, 0, "get");
  const command = [
    "text",
    "xml",
    "slides",
    "sections",
    "shows",
    "settings",
    "masters",
    "layouts",
    "fields",
    "shapes",
    "backgrounds",
    "themes"
  ].includes(args[0]!)
    ? `${args[0]}.${args.splice(1, 1)[0]}`
    : (args[0] ?? "help");
  const operation =
    command === "--help" || command === "-h"
      ? "help"
      : command === "--version"
        ? "version"
        : command;
  if (
    ![
      ...Object.keys(fieldSchemas),
      ...Object.keys(membershipSchemas),
      ...Object.keys(settingsSchemas),
      ...Object.keys(masterSchemas),
      ...Object.keys(shapeSchemas),
      "create",
      "slides.add",
      "slides.move",
      "slides.set",
      "slides.remove",
      "slides.duplicate",
      "slides.import",
      "slides.merge",
      "slides.split",
      "inspect",
      "text.get",
      "text.replace",
      "text.fit",
      "text.frames.set",
      "text.frames.get",
      "text.frames.list",
      "text.paragraphs.set",
      "text.paragraphs.get",
      "text.paragraphs.list",
      "text.runs.set",
      "text.runs.get",
      "text.runs.list",
      "xml.get",
      "xml.set",
      "schema",
      "capabilities",
      "help",
      "version"
    ].includes(operation)
  )
    usage("Unsupported operation.");
  const result: Arguments = { operation: operation as Arguments["operation"], json: false };
  const positionals: string[] = [];
  const seen = new Set<string>();
  let options = true;
  for (let index = 1; index < args.length; index++) {
    const argument = args[index] === "-o" ? "--output" : args[index]!;
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (!options || !argument.startsWith("-") || argument === "-") {
      positionals.push(argument);
      continue;
    }
    if (
      (operation.startsWith("fields.") ||
        operation.startsWith("shapes.") ||
        operation.startsWith("text.runs.") ||
        operation.startsWith("text.paragraphs.") ||
        operation.startsWith("text.frames.") ||
        operation === "text.fit") &&
      ["--help", "-h"].includes(argument)
    )
      return { operation: "help", json: output.json, schemaPath: operation };
    if (
      ["shapes.move", "shapes.align", "shapes.distribute", "shapes.duplicate"].includes(
        operation
      ) &&
      [
        "--shapes",
        "--coordinate-system",
        "--order",
        "--position",
        "--alignment",
        "--axis",
        "--offset-x",
        "--offset-y"
      ].includes(argument)
    ) {
      if (seen.has(argument)) usage("Repeated option.");
      seen.add(argument);
      const value = args[++index];
      if (value === undefined) usage("Shape selection option requires a value.");
      if (argument === "--shapes") {
        const locations = commandJson(value);
        if (!Array.isArray(locations) || locations.length === 0)
          usage("Shapes requires a nonempty location array.");
        result.shapes = locations as Location[];
      } else {
        const key =
          argument === "--coordinate-system"
            ? "coordinateSystem"
            : argument === "--offset-x"
              ? "offsetX"
              : argument === "--offset-y"
                ? "offsetY"
                : argument.slice(2);
        result.selectionEdit = {
          ...result.selectionEdit,
          action: operation.slice(7),
          [key]:
            argument === "--offset-x" || argument === "--offset-y"
              ? new Emu(commandLength(value, -Number.MAX_SAFE_INTEGER))
              : argument === "--position"
                ? Number(value)
                : value
        } as ShapeSelectionOptions;
      }
      continue;
    }
    if (
      ["shapes.group", "shapes.ungroup"].includes(operation) &&
      ["--shapes", "--tolerance"].includes(argument)
    ) {
      if (seen.has(argument)) usage("Repeated option.");
      seen.add(argument);
      const value = args[++index];
      if (value === undefined) usage("Group option requires a value.");
      if (argument === "--tolerance") result.tolerance = new Emu(commandLength(value, 0));
      else {
        const locations = commandJson(value);
        if (!Array.isArray(locations) || locations.length < 2)
          usage("Grouping requires at least two shape locations.");
        result.shapes = locations as Location[];
      }
      continue;
    }
    if (
      operation.startsWith("fields.") &&
      ["--kind", "--text", "--update", "--timestamp"].includes(argument)
    ) {
      if (seen.has(argument)) usage("Repeated option.");
      seen.add(argument);
      const value = args[++index];
      if (value === undefined) usage("Field option requires a value.");
      const key = argument.slice(2);
      result.fieldEdit = {
        ...result.fieldEdit,
        [key]: key === "timestamp" ? commandTimestamp(value) : value
      };
      continue;
    }
    if (seen.has(argument) && argument !== "--limit") usage("Repeated option.");
    seen.add(argument);
    if (argument === "--json") {
      result.json = true;
      continue;
    }
    if (["--pretty", "--in-place", "--force", "--dry-run"].includes(argument)) {
      if (argument === "--pretty") result.pretty = true;
      else if (argument === "--in-place") result.inPlace = true;
      else if (argument === "--force") result.force = true;
      else result.dryRun = true;
      continue;
    }
    if (argument === "--allow-empty") {
      result.allowEmpty = true;
      continue;
    }
    if (argument === "--allow-partial-output") {
      if (operation !== "slides.split") usage("Partial output requires slides split.");
      result.allowPartialOutput = true;
      continue;
    }
    if (argument === "--first") {
      if (operation !== "text.replace") usage("First requires text replace.");
      result.first = true;
      continue;
    }
    if (argument === "--all") {
      result.all = true;
      continue;
    }
    if (!scalarOptions.includes(argument)) usage("Unsupported option.");
    const value = args[++index];
    if (
      value === undefined ||
      (value.length === 0 &&
        ![
          "--author",
          "--name",
          "--title",
          "--body",
          "--text",
          "--matching-name",
          "--with"
        ].includes(argument))
    )
      usage("Missing option value.");
    if (operation === "text.fit" && fitFlags.includes(argument)) {
      const key = argument
        .slice(2)
        .split("-")
        .map((part, i) => (i ? part[0]!.toUpperCase() + part.slice(1) : part))
        .join("");
      let parsed: unknown = value;
      if (key === "metrics") {
        try {
          parsed = admitFontMetrics(JSON.parse(value));
        } catch (error) {
          if (error instanceof OfficeError) throw error;
          usage("Metrics require a valid JSON metric object.");
        }
      } else if (["bold", "italic", "wrap"].includes(key)) {
        if (!["true", "false"].includes(value)) usage("Text fit switches require true or false.");
        parsed = value === "true";
      } else if (key.startsWith("margin")) parsed = commandLength(value) / 12700;
      else if (key !== "fontFamily") {
        const pieces = value.split(".");
        if (pieces.length > 2 || pieces.some((p) => !p || [...p].some((c) => c < "0" || c > "9")))
          usage("Text fit sizes and spacing require decimal numbers.");
        parsed = Number(value);
      }
      result.fitEdit = { ...result.fitEdit, [key]: parsed } as TextFitOptions;
      continue;
    }
    if (operation.startsWith("text.frames.") && frameFlags.includes(argument)) {
      const key = argument
        .slice(2)
        .split("-")
        .map((part, index) => (index ? part[0]!.toUpperCase() + part.slice(1) : part))
        .join("");
      let parsed: unknown = value;
      if (value === "null" && key !== "text") parsed = null;
      else if (key.startsWith("margin")) parsed = commandLength(value, -2147483648) / 12700;
      else if (key === "wrap") {
        if (!["true", "false"].includes(value)) usage("Wrap requires true, false or null.");
        parsed = value === "true";
      } else if (key === "columns" || key === "rotation") {
        const digits = key === "rotation" && value.startsWith("-") ? value.slice(1) : value;
        const pieces = digits.split(".");
        if (
          pieces.length > (key === "columns" ? 1 : 2) ||
          pieces.some((piece) => !piece || [...piece].some((c) => c < "0" || c > "9")) ||
          !Number.isFinite(Number(value))
        )
          usage("Columns require an integer; rotation requires finite decimal degrees.");
        parsed = Number(value);
      }
      result.frameEdit = { ...result.frameEdit, [key]: parsed };
      continue;
    }
    if (operation.startsWith("text.paragraphs.") && paragraphFlags.includes(argument)) {
      let key = argument
        .slice(2)
        .split("-")
        .map((part, index) => (index ? part[0]!.toUpperCase() + part.slice(1) : part))
        .join("");
      let parsed: unknown = value;
      if (key === "direction") {
        if (seen.has("--rtl")) usage("Direction and RTL cannot be combined.");
        if (!["ltr", "rtl", "null"].includes(value)) usage("Direction requires ltr, rtl or null.");
        key = "rtl";
        parsed = value === "null" ? null : value === "rtl";
      } else if (key === "numbering") {
        if (seen.has("--bullet")) usage("Bullet and numbering cannot be combined.");
        const schemes: Record<string, string> = {
          decimal: "arabicPeriod",
          "lower-alpha": "alphaLcPeriod",
          "upper-alpha": "alphaUcPeriod",
          "lower-roman": "romanLcPeriod",
          "upper-roman": "romanUcPeriod"
        };
        if (!Object.hasOwn(schemes, value) && !["none", "null"].includes(value))
          usage("Unsupported numbering style.");
        key = "bullet";
        parsed =
          value === "null"
            ? null
            : value === "none"
              ? { kind: "none" }
              : { kind: "numbered", scheme: schemes[value] };
      } else if (value === "null" && key !== "paragraph") parsed = null;
      else if (
        [
          "marginLeft",
          "marginRight",
          "indent",
          "defaultTabSize",
          "spaceBefore",
          "spaceAfter"
        ].includes(key)
      )
        parsed = commandLength(value, key === "indent" ? -Number.MAX_SAFE_INTEGER : 0) / 12700;
      else if (key === "rtl") {
        if (!["true", "false"].includes(value)) usage("RTL requires true, false or null.");
        parsed = value === "true";
      } else if (["paragraph", "level"].includes(key)) {
        if (
          ![...value].every((c) => c >= "0" && c <= "9") ||
          !Number.isSafeInteger(Number(value)) ||
          (key === "paragraph" && Number(value) < 1)
        )
          usage("Invalid paragraph position or level.");
        parsed = Number(value) - (key === "paragraph" ? 1 : 0);
      } else if (key === "lineSpacing") {
        const pieces = value.split(".");
        const decimal =
          pieces.length <= 2 &&
          pieces.every(
            (piece) =>
              piece.length > 0 &&
              [...piece].every((character) => character >= "0" && character <= "9")
          );
        parsed = decimal
          ? { unit: "multiple", value: Number(value) }
          : { unit: "pt", value: commandLength(value, 0) / 12700 };
      } else if (key === "bullet")
        parsed = value.startsWith("{")
          ? commandJson(value)
          : { kind: "character", character: value };
      else if (key === "tabs") {
        const tabs = commandJson(value);
        if (!Array.isArray(tabs)) usage("Tabs require an array or null.");
        parsed = tabs.map((tab: unknown) => {
          if (tab && typeof tab === "object" && "unit" in tab) {
            const record = tab as Record<string, unknown>;
            return {
              position: paragraphTabLength(record),
              alignment: "left"
            };
          }
          if (
            tab &&
            typeof tab === "object" &&
            "position" in tab &&
            tab.position &&
            typeof tab.position === "object"
          ) {
            const aligned = tab as Record<string, unknown>;
            const length = tab.position as Record<string, unknown>;
            if (Object.keys(aligned).some((key) => !["position", "alignment"].includes(key)))
              usage("Tabs require finite explicit lengths.");
            return {
              position: paragraphTabLength(length),
              alignment: aligned.alignment
            };
          }
          return tab;
        });
      }
      if (argument === "--rtl" && seen.has("--direction"))
        usage("Direction and RTL cannot be combined.");
      if (argument === "--bullet" && seen.has("--numbering"))
        usage("Bullet and numbering cannot be combined.");
      result.paragraphEdit = { ...result.paragraphEdit, [key]: parsed };
      continue;
    }
    if (operation.startsWith("text.runs.") && runFlags.includes(argument)) {
      const key = argument
        .slice(2)
        .split("-")
        .map((part, index) => (index ? part[0]!.toUpperCase() + part.slice(1) : part))
        .join("");
      let parsed: unknown = value;
      if (value === "null" && !["text", "paragraph", "run"].includes(key)) parsed = null;
      else if (["complexScriptCharset", "complexScriptPitchFamily"].includes(key)) {
        const digits = value.startsWith("-") ? value.slice(1) : value;
        if (
          !digits ||
          [...digits].some((c) => c < "0" || c > "9") ||
          !Number.isSafeInteger(Number(value))
        )
          usage("Font classification requires an integer or null.");
        parsed = Number(value);
      } else if (["size", "spacing"].includes(key))
        parsed = commandLength(value, key === "spacing" ? -Number.MAX_SAFE_INTEGER : 1) / 12700;
      else if (["bold", "italic", "rtl"].includes(key)) {
        if (!["true", "false"].includes(value)) usage("Emphasis requires true, false or null.");
        parsed = value === "true";
      } else if (["paragraph", "run"].includes(key)) {
        if (
          ![...value].every((c) => c >= "0" && c <= "9") ||
          !Number.isSafeInteger(Number(value)) ||
          Number(value) < 1
        )
          usage("Text positions require positive one-based integers.");
        parsed = Number(value) - 1;
      } else if (key === "baseline") {
        if (!value.trim() || !Number.isFinite(Number(value)))
          usage("Baseline requires a finite percentage.");
        parsed = Number(value);
      } else if (["color", "highlight"].includes(key) && value.startsWith("{"))
        parsed = commandJson(value);
      else if (key === "underline" && ["true", "false"].includes(value)) parsed = value === "true";
      else if (key === "underline" && [...value].every((c) => c >= "0" && c <= "9"))
        parsed = Number(value);
      result.runEdit = { ...result.runEdit, [key]: parsed };
      continue;
    }
    if (argument === "--style-json") {
      if (operation !== "text.replace") usage("Style override requires text replace.");
      const style = commandJson(value);
      if (
        !style ||
        typeof style !== "object" ||
        Array.isArray(style) ||
        Object.keys(style).length === 0 ||
        Object.entries(style).some(
          ([key, field]) => !["bold", "italic"].includes(key) || typeof field !== "boolean"
        )
      )
        usage("Style requires explicit bold or italic boolean values.");
      result.style = style;
      continue;
    }
    if (["--find", "--with", "--occurrence"].includes(argument)) {
      if (operation !== "text.replace") usage("Match options require text replace.");
      if (argument === "--occurrence") {
        if (
          ![...value].every((c) => c >= "0" && c <= "9") ||
          !Number.isSafeInteger(Number(value)) ||
          Number(value) < 1
        )
          usage("Occurrence must be a positive integer.");
        result.occurrence = Number(value);
      } else if (argument === "--find") result.find = value;
      else result.with = value;
      continue;
    }
    if (
      operation.startsWith("layouts.") &&
      [
        "--layout",
        "--placeholder-policy",
        "--type",
        "--preserve",
        "--show-master-shapes",
        "--matching-name",
        "--placeholders-json"
      ].includes(argument)
    ) {
      const key =
        argument === "--placeholder-policy"
          ? "placeholderPolicy"
          : argument === "--show-master-shapes"
            ? "showMasterShapes"
            : argument === "--matching-name"
              ? "matchingName"
              : argument === "--placeholders-json"
                ? "placeholders"
                : argument.slice(2);
      if (["preserve", "showMasterShapes"].includes(key) && !["true", "false"].includes(value))
        usage("Expected true or false.");
      result.layoutEdit = {
        ...result.layoutEdit,
        [key]:
          key === "placeholders"
            ? commandJson(value)
            : ["preserve", "showMasterShapes"].includes(key)
              ? value === "true"
              : value
      };
      continue;
    }
    if (
      operation.startsWith("themes.") &&
      ["--name", "--color-slot", "--color", "--font-slot", "--font"].includes(argument)
    ) {
      const key =
        argument === "--color-slot"
          ? "colorSlot"
          : argument === "--font-slot"
            ? "fontSlot"
            : argument.slice(2);
      result.themeEdit = { ...result.themeEdit, [key]: value };
      continue;
    }
    if (
      operation.startsWith("backgrounds.") &&
      ["--kind", "--color", "--stops", "--angle", "--style-index", "--style-color"].includes(
        argument
      )
    ) {
      const key =
        argument === "--style-index"
          ? "styleIndex"
          : argument === "--style-color"
            ? "styleColor"
            : argument.slice(2);
      result.backgroundEdit = {
        ...result.backgroundEdit,
        [key]:
          key === "stops"
            ? commandJson(value)
            : ["angle", "styleIndex"].includes(key)
              ? commandJson(value)
              : value
      };
      continue;
    }
    if (operation.startsWith("shapes.paths.") && argument === "--close") {
      if (!["true", "false"].includes(value)) usage("Close requires true or false.");
      result.close = value === "true";
      continue;
    }
    if (operation.startsWith("shapes.paths.") && ["--path", "--vertices"].includes(argument)) {
      if (argument === "--path") result.path = commandJson(value) as ShapePath;
      else result.vertices = commandJson(value);
      continue;
    }
    if (
      operation.startsWith("shapes.") &&
      [
        "--kind",
        "--name",
        "--text",
        "--title",
        "--description",
        "--alt-text",
        "--locked",
        "--fill",
        "--line-color",
        "--line-width",
        "--left",
        "--top",
        "--width",
        "--height",
        "--rotation",
        "--flip-horizontal",
        "--flip-vertical"
      ].includes(argument)
    ) {
      const key = argument
        .slice(2)
        .split("-")
        .map((part, index) => (index ? part[0]!.toUpperCase() + part.slice(1) : part))
        .join("");
      let parsed: unknown = value;
      if (key === "lineWidth" && value === "null") parsed = null;
      else if (["left", "top", "width", "height", "lineWidth"].includes(key)) {
        const length = commandLength(
          value,
          ["left", "top"].includes(key) ? -27273042316900 : key === "lineWidth" ? 0 : 1
        );
        if (Math.abs(length) > 27273042316900) usage("Shape geometry exceeds DrawingML bounds.");
        parsed = { value: length, unit: "emu" };
      } else if (key === "flipHorizontal" || key === "flipVertical") {
        if (!["true", "false"].includes(value)) usage("Flips require true or false.");
        parsed = value === "true";
      } else if (key === "locked") {
        if (!["true", "false", "null"].includes(value))
          usage("Locked requires true, false or null.");
        parsed = value === "null" ? null : value === "true";
      } else if (key === "rotation") {
        if (!value.trim() || !Number.isFinite(Number(value)))
          usage("Rotation requires finite degrees.");
        parsed = Number(value);
      } else if (key === "kind" && value.length && [...value].every((c) => c >= "0" && c <= "9"))
        parsed = Number(value);
      else if (
        ["fill", "lineColor", "title", "description", "altText"].includes(key) &&
        value === "null"
      )
        parsed = null;
      result.shapeEdit = { ...result.shapeEdit, [key]: parsed };
      continue;
    }
    if (
      Object.hasOwn(masterSchemas, operation) &&
      [
        "--name",
        "--text",
        "--theme",
        "--master",
        "--kind",
        "--color",
        "--left",
        "--top",
        "--width",
        "--height"
      ].includes(argument)
    ) {
      const key = argument === "--left" ? "x" : argument === "--top" ? "y" : argument.slice(2);
      result.masterEdit = {
        ...result.masterEdit,
        [key]: ["x", "y", "width", "height"].includes(key)
          ? commandLength(value, key === "x" || key === "y" ? -27273042316900 : 1)
          : value
      };
      continue;
    }
    if (
      [
        "--notes-width",
        "--scale-content",
        "--notes-height",
        "--orientation",
        "--notes-orientation",
        "--slide-number-start",
        "--loop",
        "--show-type"
      ].includes(argument) ||
      (operation === "settings.set" && ["--width", "--height"].includes(argument))
    ) {
      if (operation !== "settings.set") usage("Settings options require settings set.");
      if (["--width", "--height", "--notes-width", "--notes-height"].includes(argument)) {
        const key =
          argument === "--notes-width"
            ? "notesWidth"
            : argument === "--notes-height"
              ? "notesHeight"
              : argument.slice(2);
        result.settings = {
          ...result.settings,
          [key]: commandLength(value, key === "notesWidth" || key === "notesHeight" ? 0 : 1)
        };
      } else if (argument === "--orientation" || argument === "--notes-orientation") {
        if (value !== "portrait" && value !== "landscape")
          usage("Orientation requires portrait or landscape.");
        result.settings = {
          ...result.settings,
          [argument === "--orientation" ? "orientation" : "notesOrientation"]: value
        };
      } else if (argument === "--slide-number-start") {
        const digits = value.startsWith("-") ? value.slice(1) : value;
        if (
          !digits.length ||
          ![...digits].every((c) => c >= "0" && c <= "9") ||
          !Number.isSafeInteger(Number(value))
        )
          usage("Slide-number start requires a safe integer.");
        result.settings = { ...result.settings, slideNumberStart: Number(value) };
      } else if (argument === "--loop" || argument === "--scale-content") {
        if (value !== "true" && value !== "false") usage("Boolean settings require true or false.");
        result.settings = {
          ...result.settings,
          [argument === "--loop" ? "loop" : "scaleContent"]: value === "true"
        };
      } else {
        if (value !== "speaker" && value !== "window" && value !== "kiosk")
          usage("Unknown show type.");
        result.settings = { ...result.settings, showType: value };
      }
      continue;
    }
    if (
      Object.hasOwn(membershipSchemas, operation) &&
      ["--name", "--slides", "--position"].includes(argument)
    ) {
      if (argument === "--name") result.membership = { ...result.membership, name: value };
      else if (argument === "--slides") {
        const slides = commandJson(value);
        if (
          !Array.isArray(slides) ||
          !slides.length ||
          slides.some((item) => !Number.isSafeInteger(item) || item < 1) ||
          new Set(slides).size !== slides.length
        )
          usage("Members require a nonempty array of unique one-based slide positions.");
        result.membership = { ...result.membership, slides };
      } else {
        if (
          ![...value].every((c) => c >= "0" && c <= "9") ||
          !Number.isSafeInteger(Number(value)) ||
          Number(value) < 1
        )
          usage("Section positions must be positive integers.");
        result.membership = { ...result.membership, position: Number(value) };
      }
      continue;
    }
    if (argument === "--sources") {
      if (operation !== "slides.merge") usage("Sources require slides merge.");
      const sources = commandJson(value);
      if (
        !Array.isArray(sources) ||
        !sources.length ||
        sources.some(
          (source) =>
            !source ||
            typeof source !== "object" ||
            Array.isArray(source) ||
            Object.keys(source).length !== 1 ||
            typeof source.vfsPath !== "string" ||
            !source.vfsPath.length
        )
      )
        usage("Sources require a nonempty ordered array of scoped vfsPath inputs.");
      const paths = sources.map((source: { vfsPath: string }) => source.vfsPath);
      if (new Set(paths).size !== paths.length) usage("Source inputs must be unique.");
      result.sources = paths;
      continue;
    }
    if (argument === "--output-dir" || argument === "--slides") {
      if (operation !== "slides.split") usage("Option requires slides split.");
      if (argument === "--output-dir") result.outputDir = value;
      else {
        const positions = commandJson(value);
        if (
          !Array.isArray(positions) ||
          !positions.length ||
          positions.some((position) => !Number.isSafeInteger(position) || position < 1) ||
          new Set(positions).size !== positions.length
        )
          usage("Slides require a nonempty array of unique one-based positions.");
        result.splitSlides = positions;
      }
      continue;
    }
    if (argument === "--reference-policy") {
      if (operation !== "slides.remove" || value !== "remove")
        usage("Slide removal reference policy must be remove.");
      result.referencePolicy = value;
      continue;
    }
    if (
      ["--source", "--source-slides", "--theme-policy", "--dimension-policy"].includes(argument)
    ) {
      if (operation !== "slides.import" && operation !== "slides.merge")
        usage("Option requires slides import or merge.");
      if (operation === "slides.merge" && argument === "--source")
        usage("Merge requires --sources.");
      if (argument === "--source") result.source = value;
      else if (argument === "--source-slides") {
        const positions = commandJson(value);
        if (
          !Array.isArray(positions) ||
          !positions.length ||
          positions.some((position) => !Number.isSafeInteger(position) || position < 1) ||
          new Set(positions).size !== positions.length
        )
          usage("Source slides require a nonempty array of unique one-based positions.");
        result.importing = { ...result.importing, sourceSlides: positions };
      } else if (argument === "--theme-policy") {
        if (value !== "source" && value !== "destination") usage("Unknown theme policy.");
        result.importing = { ...result.importing, themePolicy: value };
      } else {
        if (value !== "reject" && value !== "destination") usage("Unknown dimension policy.");
        result.importing = { ...result.importing, dimensionPolicy: value };
      }
      continue;
    }
    if (
      [
        "--layout",
        "--position",
        "--name",
        "--hidden",
        "--follow-master-background",
        "--title",
        "--body",
        "--placeholders-json"
      ].includes(argument)
    ) {
      if (
        operation === "slides.import" ||
        operation === "slides.duplicate" ||
        operation === "slides.move" ||
        operation === "slides.set"
      ) {
        if (argument === "--position") {
          if (
            ![...value].every((character) => character >= "0" && character <= "9") ||
            !Number.isSafeInteger(Number(value)) ||
            Number(value) < 1
          )
            usage("Slide positions must be positive one-based integers.");
          if (operation === "slides.import")
            result.importing = { ...result.importing, position: Number(value) };
          else result.mutation = { ...result.mutation, position: Number(value) };
        } else if (operation === "slides.set" && argument === "--name")
          result.mutation = { ...result.mutation, name: value };
        else if (operation === "slides.set" && argument === "--hidden") {
          if (value !== "true" && value !== "false")
            usage("Slide boolean options require true or false.");
          result.mutation = { ...result.mutation, hidden: value === "true" };
        } else usage("Option is unavailable for this slide operation.");
        continue;
      }
      if (operation !== "slides.add") usage("Slide addition options require slides add.");
      result.addition ??= {};
      if (argument === "--position") {
        if (
          ![...value].every((character) => character >= "0" && character <= "9") ||
          !Number.isSafeInteger(Number(value)) ||
          Number(value) < 1
        )
          usage("Insertion positions must be positive one-based integers.");
        result.addition = { ...result.addition, position: Number(value) };
      } else if (argument === "--hidden" || argument === "--follow-master-background") {
        if (value !== "true" && value !== "false")
          usage("Slide boolean options require true or false.");
        result.addition = {
          ...result.addition,
          [argument === "--hidden" ? "hidden" : "followMasterBackground"]: value === "true"
        };
      } else if (argument === "--placeholders-json") {
        const placeholders = commandJson(value);
        if (!Array.isArray(placeholders)) usage("Placeholders require an array.");
        for (const binding of placeholders) {
          if (
            !binding ||
            typeof binding !== "object" ||
            Array.isArray(binding) ||
            Object.keys(binding).some((key) => !["type", "index", "text"].includes(key)) ||
            typeof binding.type !== "string" ||
            !binding.type.length ||
            typeof binding.text !== "string" ||
            (Object.hasOwn(binding, "index") &&
              (!Number.isSafeInteger(binding.index) ||
                binding.index < 0 ||
                binding.index > 4294967295))
          )
            usage("Placeholder bindings require type, optional nonnegative index, and text.");
        }
        result.addition = { ...result.addition, placeholders };
      } else result.addition = { ...result.addition, [argument.slice(2)]: value };
      continue;
    }
    if (
      [
        "--width",
        "--height",
        "--kind",
        "--dialect",
        "--template",
        "--timestamp",
        "--author",
        "--slides-json",
        "--properties-json"
      ].includes(argument)
    ) {
      if (operation !== "create") usage("Creation options require create.");
      result.creation ??= {};
      if (argument === "--template") result.template = value;
      else if (argument === "--width" || argument === "--height")
        result.creation = { ...result.creation, [argument.slice(2)]: commandLength(value) };
      else if (argument === "--kind") {
        if (!["pptx", "potx", "ppsx"].includes(value)) usage("Unknown presentation kind.");
        result.creation = { ...result.creation, kind: value as "pptx" | "potx" | "ppsx" };
      } else if (argument === "--dialect") {
        if (!["strict", "transitional"].includes(value)) usage("Unknown presentation dialect.");
        result.creation = { ...result.creation, dialect: value as "strict" | "transitional" };
      } else if (argument === "--author") result.creation = { ...result.creation, author: value };
      else if (argument === "--timestamp")
        result.creation = { ...result.creation, timestamp: commandTimestamp(value) };
      else if (argument === "--properties-json") {
        const properties = commandJson(value);
        if (!properties || typeof properties !== "object" || Array.isArray(properties))
          usage("Properties require an object.");
        if (
          Object.keys(properties).some(
            (key) =>
              ![
                "title",
                "subject",
                "author",
                "keywords",
                "comments",
                "lastModifiedBy",
                "revision",
                "created",
                "modified",
                "lastPrinted"
              ].includes(key)
          )
        )
          usage("Unknown creation property.");
        for (const key of ["created", "modified", "lastPrinted"]) {
          if (Object.hasOwn(properties, key)) {
            const dates = properties as Record<string, unknown>;
            if (typeof dates[key] !== "string") usage("Property dates require UTC strings.");
            dates[key] = commandTimestamp(dates[key]);
          }
        }
        result.creation = {
          ...result.creation,
          properties: Object.fromEntries(
            Object.entries(properties).map(([key, item]) => [
              key === "lastPrinted"
                ? "last_printed"
                : key === "lastModifiedBy"
                  ? "last_modified_by"
                  : key,
              item
            ])
          )
        };
      } else
        result.creation = {
          ...result.creation,
          slides: commandJson(value) as NonNullable<CreatePresentationOptions["slides"]>
        };
      continue;
    }
    if (argument === "--selection-json") {
      if (
        operation !== "slides.move" &&
        operation !== "slides.set" &&
        operation !== "slides.remove" &&
        operation !== "slides.duplicate"
      )
        usage("Selection JSON requires a supported slide mutation.");
      const selection = commandJson(value);
      if (!selection || typeof selection !== "object")
        usage("Selection JSON requires a query or nonempty query array.");
      const queries = Array.isArray(selection) ? selection : [selection];
      if (!queries.length) usage("Selection arrays must not be empty.");
      for (const query of queries) {
        if (
          !query ||
          typeof query !== "object" ||
          Array.isArray(query) ||
          Object.keys(query).some(
            (key) =>
              !["kind", "scope", "owner", "position", "id", "name", "token", "all"].includes(key)
          )
        )
          usage("Invalid slide selection query.");
        if (query.token !== undefined) {
          if (
            typeof query.token !== "string" ||
            Object.keys(query).some((key) => !["kind", "token"].includes(key)) ||
            (query.kind !== undefined && query.kind !== "slide")
          )
            usage("Invalid slide token query.");
          decodeSelectionToken(query.token);
          continue;
        }
        if (
          query.kind !== "slide" ||
          (query.scope !== undefined && query.scope !== "slides") ||
          (query.all !== undefined && typeof query.all !== "boolean")
        )
          usage("Selection queries must address slides.");
        for (const key of ["id", "name", "owner"])
          if (
            query[key] !== undefined &&
            (typeof query[key] !== "string" || (key !== "name" && !query[key]))
          )
            usage("Invalid slide selection value.");
        if ([query.position, query.id, query.name].filter((item) => item !== undefined).length > 1)
          usage("Slide identity selectors cannot be combined.");
        if (
          !query.all &&
          query.position === undefined &&
          query.id === undefined &&
          query.name === undefined
        )
          usage("Slide selection requires an identity or all.");
        if (query.position !== undefined) {
          const position = query.position;
          if (
            !position ||
            typeof position !== "object" ||
            Array.isArray(position) ||
            Object.keys(position).some((key) => !["coordinateSystem", "value"].includes(key)) ||
            !["one-based", "zero-based"].includes(position.coordinateSystem) ||
            !Number.isSafeInteger(position.value) ||
            position.value < (position.coordinateSystem === "one-based" ? 1 : 0)
          )
            usage("Invalid slide selection coordinate.");
        }
      }
      result.selection = selection as SelectionQuery | readonly SelectionQuery[];
      continue;
    }
    if (argument === "--limit") {
      const pieces = value.split("=");
      const [name, digits] = pieces;
      if (
        pieces.length !== 2 ||
        !name ||
        !digits ||
        ![...digits].every((c) => c >= "0" && c <= "9") ||
        !Number.isSafeInteger(Number(digits)) ||
        Number(digits) < 1
      )
        usage("Limits require NAME=POSITIVE_INTEGER.");
      result.limits ??= {};
      if (Object.hasOwn(result.limits, name)) usage("Repeated limit name.");
      if (!["maxBytes", "maxNodes", "maxDepth", "maxOutputBytes"].includes(name))
        usage("Unknown limit name.");
      result.limits[name] = Number(digits);
    } else if (argument === "--slide") {
      if (
        ![...value].every((character) => character >= "0" && character <= "9") ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < 1
      )
        usage("Slide positions must be positive one-based integers.");
      result.slide = Number(value);
    } else if (argument === "--shape") result.shape = value;
    else if (argument === "--part") {
      try {
        result.part = partName(value, false);
      } catch {
        throw new SelectionError("invalid-selection");
      }
    } else if (argument === "--select") result.token = value;
    else if (argument === "--file") result.file = value;
    else if (argument === "--output") result.output = value;
    else {
      if (!scopes.includes(value as Scope)) usage("Unknown scope.");
      result.scope = value as Scope;
    }
  }
  const xml = operation === "xml.get" || operation === "xml.set";
  const slideMutation =
    operation === "slides.duplicate" ||
    operation === "slides.move" ||
    operation === "slides.set" ||
    operation === "slides.remove";
  const membershipOperation = Object.hasOwn(membershipSchemas, operation);
  if (
    operation.startsWith("fields.") ||
    operation === "text.get" ||
    operation === "text.fit" ||
    operation === "text.replace" ||
    operation.startsWith("text.runs.") ||
    operation.startsWith("text.paragraphs.") ||
    operation.startsWith("text.frames.")
  ) {
    const fields = operation.startsWith("fields.");
    const paragraphs = operation.startsWith("text.paragraphs.");
    const runs = operation.startsWith("text.runs.");
    const frames = operation.startsWith("text.frames.");
    const fitting = operation === "text.fit";
    const formatting = fields || runs || paragraphs || frames || fitting;
    const mutation =
      operation.endsWith(".set") ||
      operation === "text.replace" ||
      fitting ||
      (fields && ["fields.add", "fields.remove"].includes(operation));
    const allowed = [
      "--json",
      "--limit",
      "--select",
      "--scope",
      "--slide",
      "--shape",
      ...(fields && mutation && operation !== "fields.remove"
        ? ["--kind", "--text", "--update", "--timestamp"]
        : []),
      ...(frames && mutation ? frameFlags : []),
      ...(fitting ? fitFlags : []),
      ...(runs ? (mutation ? runFlags : ["--paragraph", "--run"]) : []),
      ...(paragraphs ? (mutation ? paragraphFlags : ["--paragraph"]) : []),
      ...(mutation
        ? [
            "--style-json",
            "--find",
            "--with",
            "--first",
            "--all",
            "--occurrence",
            "--allow-empty",
            "--output",
            "--in-place",
            "--force",
            "--dry-run"
          ]
        : [])
    ];
    if (
      formatting &&
      [...seen].some((flag) =>
        ["--style-json", "--find", "--with", "--first", "--occurrence"].includes(flag)
      )
    )
      usage("Match options do not apply to runs.");
    if ([...seen].some((flag) => !allowed.includes(flag)))
      usage("Option does not apply to this text operation.");
    if (positionals.length !== 1 || !positionals[0]) usage("Text operation requires one input.");
    if (result.scope === "presentation" || result.scope === "shared")
      usage("Text operation requires a text-bearing scope.");
    if (
      result.token &&
      ["--scope", "--slide", "--shape", "--paragraph", "--run"].some((flag) => seen.has(flag))
    )
      usage("Opaque and simple selectors cannot be combined.");
    if (
      result.slide !== undefined &&
      (result.scope === "notes-master" || result.scope === "handout-master")
    )
      usage("Deck-level text master scopes do not accept slide selection.");
    if (result.shape && result.slide === undefined)
      usage("Shape selection requires an owning slide.");
    result.input = positionals[0];
    if (mutation) {
      if (fields)
        validateFieldOptions(
          result.fieldEdit ?? {},
          operation.slice(7) as "set" | "add" | "remove"
        );
      if (fitting) {
        if (!result.fitEdit?.metrics) usage("Text fit requires --metrics JSON.");
        validateTextFitOptions(result.fitEdit);
      }
      if (frames)
        validateTextFrameOptions({ ...result.frameEdit, ...(result.all ? { all: true } : {}) });
      if (paragraphs)
        validateTextParagraphOptions({
          ...result.paragraphEdit,
          ...(result.all ? { all: true } : {})
        });
      if (runs) validateTextRunOptions({ ...result.runEdit, ...(result.all ? { all: true } : {}) });
      if (
        formatting &&
        !result.all &&
        result.token === undefined &&
        result.slide === undefined &&
        result.shape === undefined &&
        result.paragraphEdit?.paragraph === undefined &&
        result.runEdit?.paragraph === undefined &&
        result.runEdit?.run === undefined
      )
        throw new SelectionError("missing-selection");
      if (!formatting && (result.find === undefined || result.with === undefined))
        usage("Text replace requires find and with.");
      if (
        !formatting &&
        [result.first === true, result.all === true, result.occurrence !== undefined].filter(
          Boolean
        ).length !== 1
      )
        usage("Text replace requires exactly one of first, all or occurrence.");
      if (result.inPlace && result.input === "-") usage("Stdin cannot be edited in place.");
      if (result.inPlace && result.output) usage("Output and in-place cannot be combined.");
      if (!result.dryRun && !result.inPlace && !result.output)
        usage("Mutation requires a destination.");
      if (result.force && !result.output) usage("Force requires an explicit output destination.");
      if (result.output === result.input && result.output !== "-")
        usage("Replacing input requires --in-place.");
      if (result.output === "-" && result.json && !result.dryRun)
        usage("Binary stdout cannot be combined with JSON.");
    }
    return result;
  }
  if (Object.hasOwn(shapeSchemas, operation)) {
    const selectionMutation = [
      "shapes.move",
      "shapes.align",
      "shapes.distribute",
      "shapes.duplicate"
    ].includes(operation);
    const grouping = operation === "shapes.group" || operation === "shapes.ungroup";
    const mutation =
      selectionMutation || grouping || operation.endsWith(".add") || operation.endsWith(".set");
    const flags = Object.keys(shapeSchemas[operation]!.options.properties).map(
      (key) =>
        "--" + [...key].map((c) => (c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c)).join("")
    );
    if ([...seen].some((flag) => !flags.includes(flag)))
      usage("Option does not apply to this shape operation.");
    if (positionals.length !== 1 || !positionals[0]) usage("Shape operations require one input.");
    result.input = positionals[0];
    if (result.token && (result.slide !== undefined || result.part || result.shape || result.all))
      usage("Opaque and simple selectors cannot be combined.");
    if (mutation) {
      if (selectionMutation) {
        if (
          result.shapes &&
          (result.slide !== undefined ||
            result.part ||
            result.shape ||
            result.token ||
            result.all ||
            result.allowEmpty)
        )
          usage("Location arrays and simple or opaque selectors cannot be combined.");
        result.selectionEdit = {
          ...result.selectionEdit,
          action: operation.slice(7),
          ...(result.shapes === undefined ? {} : { shapes: result.shapes }),
          ...(result.scope === undefined ? {} : { scope: result.scope }),
          ...(result.slide === undefined ? {} : { slide: result.slide }),
          ...(result.part === undefined ? {} : { part: result.part }),
          ...(result.shape === undefined ? {} : { shape: result.shape }),
          ...(result.token === undefined ? {} : { select: result.token }),
          ...(result.all === undefined ? {} : { all: result.all }),
          ...(result.allowEmpty === undefined ? {} : { allowEmpty: result.allowEmpty })
        } as ShapeSelectionOptions;
        validateShapeSelectionOptions(result.selectionEdit);
      } else if (grouping) {
        if (result.tolerance === undefined) usage("Grouping requires explicit tolerance.");
        if (operation === "shapes.group" && result.shapes === undefined)
          usage("Grouping requires shape locations.");
        validateGroupOptions(
          {
            tolerance: result.tolerance,
            ...(result.shapes === undefined ? {} : { shapes: result.shapes }),
            ...(result.scope === undefined ? {} : { scope: result.scope }),
            ...(result.slide === undefined ? {} : { slide: result.slide }),
            ...(result.part === undefined ? {} : { part: result.part }),
            ...(result.shape === undefined ? {} : { shape: result.shape }),
            ...(result.token === undefined ? {} : { select: result.token }),
            ...(result.all === undefined ? {} : { all: result.all }),
            ...(result.allowEmpty === undefined ? {} : { allowEmpty: result.allowEmpty })
          },
          operation === "shapes.group"
        );
      } else if (operation.startsWith("shapes.paths.")) {
        if (
          result.path !== undefined &&
          (result.vertices !== undefined || result.close !== undefined)
        )
          usage("Path and vertices/close cannot be combined.");
        if (result.vertices !== undefined) {
          if (result.close === undefined) usage("Vertices require explicit --close true|false.");
          if (
            !Array.isArray(result.vertices) ||
            result.vertices.some((vertex) => Array.isArray(vertex))
          )
            usage("Vertices require objects with x and y coordinates.");
          result.path = pathFromVertices(result.vertices, result.close);
        }
        if (result.path === undefined) usage("Path mutation requires --path or --vertices.");
        validateShapePath(result.path);
        if (operation.endsWith(".add"))
          validateShapeOptions({ ...result.shapeEdit, kind: "text-box" }, true);
      } else {
        if (!result.shapeEdit) usage("Shape mutation requires update fields.");
        validateShapeOptions(result.shapeEdit, operation === "shapes.add");
      }
      if (result.inPlace && result.input === "-") usage("Stdin cannot be edited in place.");
      if (result.inPlace && result.output) usage("Output and in-place cannot be combined.");
      if (!result.dryRun && !result.inPlace && !result.output)
        usage("Mutation requires a destination.");
      if (result.force && !result.output) usage("Force requires an explicit output destination.");
      if (result.output === result.input && result.output !== "-")
        usage("Replacing input requires --in-place.");
      if (result.output === "-" && result.json && !result.dryRun)
        usage("Binary stdout cannot be combined with JSON.");
    }
    return result;
  }
  if (Object.hasOwn(masterSchemas, operation)) {
    const schema = masterSchemas[operation]!;
    const mutation = !operation.endsWith(".list") && !operation.endsWith(".get");
    const layout = operation.startsWith("layouts.");
    const applying = operation === "layouts.apply";
    const theme = operation.startsWith("themes.");
    const background = operation.startsWith("backgrounds.");
    const flags = Object.keys(schema.options.properties).map((key) =>
      key === "placeholders"
        ? "--placeholders-json"
        : "--" +
          [...key]
            .map((char) => (char >= "A" && char <= "Z" ? "-" + char.toLowerCase() : char))
            .join("")
    );
    if ([...seen].some((flag) => !flags.includes(flag)))
      usage("Option does not apply to this shared-content operation.");
    if (positionals.length !== 1 || !positionals[0])
      usage("Shared-content operations require one input.");
    result.input = positionals[0];
    if (mutation && !applying && !background && result.scope === undefined)
      usage("Shared-content mutation requires explicit scope.");
    if (
      result.scope !== undefined &&
      !(
        theme
          ? ["shared"]
          : background
            ? ["slides", "layouts", "masters", "shared"]
            : applying
              ? ["slides"]
              : layout
                ? ["layouts", "shared"]
                : ["masters", "shared"]
      ).includes(result.scope)
    )
      usage("Scope does not match this shared-content operation.");
    if (applying && result.token && result.scope !== undefined)
      usage("Opaque selectors cannot be combined with scope.");
    if (result.token && (result.part || result.slide !== undefined || result.shape || result.all))
      usage("Opaque and simple selectors cannot be combined.");
    if (result.part && result.slide !== undefined)
      usage("Part and slide selectors cannot be combined.");
    const edit = result.masterEdit;
    if (operation === "masters.add" && !edit?.name) usage("Master creation requires a name.");
    if (operation === "masters.set" && edit?.name === undefined && edit?.text === undefined)
      usage("Master set requires name or text.");
    if (operation === "masters.set" && edit?.text !== undefined && !result.shape && !result.token)
      usage("Master text edits require a selected text shape.");
    if (operation === "layouts.add" && (!edit?.name || !edit.master))
      usage("Layout creation requires name and master.");
    if (operation === "layouts.set" && !edit && !result.layoutEdit)
      usage("Layout set requires update fields.");
    if (operation === "layouts.set" && edit?.text !== undefined && !result.shape && !result.token)
      usage("Layout text requires a selected shape.");
    if (
      layout &&
      mutation &&
      operation !== "layouts.add" &&
      !result.part &&
      !result.token &&
      result.slide === undefined &&
      !result.all
    )
      usage("Layout mutation requires an explicit selector.");
    if (
      applying &&
      (!result.layoutEdit?.layout ||
        !["type-index", "reject-unmatched"].includes(result.layoutEdit.placeholderPolicy!))
    )
      usage("Layout application requires layout and placeholder policy.");
    if (
      operation === "shapes.add" &&
      (edit?.kind !== "text-box" ||
        [edit.x, edit.y, edit.width, edit.height].some((value) => value === undefined))
    )
      usage("Master shape creation requires text-box kind and explicit geometry.");
    if (operation === "shapes.set" && (!edit || (!result.shape && !result.token)))
      usage("Shape edits require update fields and a selected shape.");
    if (
      operation === "themes.set" &&
      (!result.themeEdit ||
        (result.themeEdit.colorSlot === undefined) !== (result.themeEdit.color === undefined) ||
        (result.themeEdit.fontSlot === undefined) !== (result.themeEdit.font === undefined))
    )
      usage("Theme set requires paired palette or font values, or a name.");
    if (
      result.themeEdit?.colorSlot !== undefined &&
      !themeColorSlots.includes(result.themeEdit.colorSlot)
    )
      usage("Unknown theme color slot.");
    if (
      result.themeEdit?.fontSlot !== undefined &&
      !themeFontSlots.includes(result.themeEdit.fontSlot)
    )
      usage("Unknown theme font slot.");
    if (background && result.scope === "shared" && !result.part && !result.token)
      usage("Shared background scope requires an exact part or selector.");
    if (operation === "backgrounds.set") {
      if (!result.part && !result.token && result.slide === undefined && !result.all)
        usage("Background mutation requires a selector or all.");
      if (result.file === "-" && result.input === "-")
        usage("Presentation and image cannot both read stdin.");
      const edit = result.backgroundEdit;
      const required = {
        solid: ["color"],
        gradient: ["stops"],
        picture: ["file"],
        inherit: [],
        "style-reference": ["styleIndex", "styleColor"]
      } as const;
      if (!edit?.kind || !Object.hasOwn(required, edit.kind)) usage("Background kind is required.");
      const fields = { ...edit, ...(result.file === undefined ? {} : { file: result.file }) };
      const keys: readonly string[] = required[edit.kind];
      if (
        keys.some((key) => !Object.hasOwn(fields, key)) ||
        Object.keys(fields).some(
          (key) =>
            key !== "kind" && !keys.includes(key) && !(edit.kind === "gradient" && key === "angle")
        )
      )
        usage("Background payload does not match its kind.");
    }
    if (mutation) {
      if (result.inPlace && result.input === "-") usage("Stdin cannot be edited in place.");
      if (result.inPlace && result.output) usage("Output and in-place cannot be combined.");
      if (!result.dryRun && !result.inPlace && !result.output)
        usage("Mutation requires a destination.");
      if (result.force && !result.output) usage("Force requires an explicit output destination.");
      if (result.output === result.input && result.output !== "-")
        usage("Replacing input requires --in-place.");
      if (result.output === "-" && result.json && !result.dryRun)
        usage("Binary stdout cannot be combined with JSON.");
    }
    return result;
  }
  if (Object.hasOwn(settingsSchemas, operation)) {
    const mutation = operation === "settings.set";
    const allowed = [
      "--json",
      "--limit",
      ...(mutation
        ? [
            "--width",
            "--height",
            "--notes-width",
            "--notes-height",
            "--orientation",
            "--notes-orientation",
            "--slide-number-start",
            "--loop",
            "--show-type",
            "--scale-content",
            "--output",
            "--in-place",
            "--force",
            "--dry-run"
          ]
        : [])
    ];
    if ([...seen].some((flag) => !allowed.includes(flag)))
      usage("Option does not apply to this settings operation.");
    if (positionals.length !== 1 || !positionals[0]) usage("Settings require one input.");
    result.input = positionals[0];
    if (mutation) {
      if (!result.settings) usage("Settings set requires update fields.");
      if (result.inPlace && result.input === "-") usage("Stdin cannot be edited in place.");
      if (result.inPlace && result.output) usage("Output and in-place cannot be combined.");
      if (!result.dryRun && !result.inPlace && !result.output)
        usage("Mutation requires a destination.");
      if (result.force && !result.output) usage("Force requires an explicit output destination.");
      if (result.output === result.input && result.output !== "-")
        usage("Replacing input requires --in-place.");
      if (result.output === "-" && result.json && !result.dryRun)
        usage("Binary stdout cannot be combined with JSON.");
    }
    return result;
  }
  if (membershipOperation) {
    const action = operation.split(".")[1];
    const mutation = !["list", "get"].includes(action!);
    const allowed = [
      "--json",
      "--limit",
      "--select",
      "--scope",
      "--slide",
      ...(mutation
        ? ["--output", "--in-place", "--force", "--dry-run", "--all", "--allow-empty"]
        : []),
      ...(["add", "set"].includes(action!) ? ["--name", "--slides", "--position"] : [])
    ];
    if ([...seen].some((flag) => !allowed.includes(flag)))
      usage("Option does not apply to this membership operation.");
    if (positionals.length !== 1 || !positionals[0])
      usage("Membership operations require one input.");
    result.input = positionals[0];
    if (result.scope !== undefined && result.scope !== "presentation")
      usage("Membership operations require presentation scope.");
    if (result.token && ["--slide", "--scope", "--all"].some((flag) => seen.has(flag)))
      usage("Opaque and simple selectors cannot be combined.");
    if (action === "add" && (result.membership?.name === undefined || !result.membership.slides))
      usage("Membership creation requires name and slides.");
    if (action === "set" && !result.membership) usage("Membership set requires update fields.");
    if (mutation) {
      if (result.inPlace && result.input === "-") usage("Stdin cannot be edited in place.");
      if (result.inPlace && result.output) usage("Output and in-place cannot be combined.");
      if (!result.dryRun && !result.inPlace && !result.output)
        usage("Mutation requires a destination.");
      if (result.force && !result.output) usage("Force requires an explicit output destination.");
      if (result.output === result.input && result.output !== "-")
        usage("Replacing input requires --in-place.");
      if (result.output === "-" && result.json && !result.dryRun)
        usage("Binary stdout cannot be combined with JSON.");
    }
    return result;
  }
  if (result.allowEmpty && !slideMutation)
    usage("Allow-empty requires a supported slide mutation.");
  if (operation === "slides.merge" || operation === "slides.split") {
    const allowed = [
      "--json",
      "--limit",
      "--force",
      "--dry-run",
      ...(operation === "slides.merge"
        ? [
            "--sources",
            "--source-slides",
            "--theme-policy",
            "--dimension-policy",
            "--output",
            "--in-place"
          ]
        : ["--slides", "--output-dir", "--allow-partial-output"])
    ];
    if ([...seen].some((option) => !allowed.includes(option)))
      usage("Option does not apply to this assembly operation.");
    if (positionals.length !== 1 || !positionals[0])
      usage("Assembly requires one destination or source input.");
    result.input = positionals[0];
    if (operation === "slides.split") {
      if (!result.splitSlides) usage("Split requires --slides.");
      if (!result.outputDir && !result.dryRun) usage("Split requires --output-dir.");
      if (result.outputDir === "-") usage("Output directories cannot be stdout.");
      if (result.force && !result.outputDir) usage("Force requires an output directory.");
    } else {
      if (!result.sources || !result.importing?.themePolicy)
        usage("Merge requires sources and an explicit theme policy.");
      if ([result.input, ...result.sources].filter((path) => path === "-").length > 1)
        usage("Only one input may consume stdin.");
      if (result.inPlace && result.input === "-") usage("Stdin cannot be edited in place.");
      if (result.inPlace && result.output) usage("Output and in-place cannot be combined.");
      if (!result.dryRun && !result.inPlace && !result.output)
        usage("Merge requires a destination.");
      if (result.force && !result.output) usage("Force requires an explicit output destination.");
      if (result.output === result.input && result.output !== "-")
        usage("Replacing input requires --in-place.");
      if (
        result.sources.includes(result.inPlace ? result.input : (result.output ?? "")) &&
        (result.inPlace || result.output !== "-")
      )
        usage("Merge output cannot replace a source.");
      if (result.output === "-" && result.json && !result.dryRun)
        usage("Binary stdout cannot be combined with JSON.");
    }
    return result;
  }
  if (operation === "create") {
    if (positionals.length) usage("Creation takes no input positional arguments.");
    const allowed = [
      "--width",
      "--height",
      "--kind",
      "--dialect",
      "--template",
      "--timestamp",
      "--author",
      "--slides-json",
      "--properties-json",
      "--json",
      "--limit",
      "--output",
      "--force",
      "--dry-run"
    ];
    if ([...seen].some((option) => !allowed.includes(option)))
      usage("Option does not apply to creation.");
    if (!result.output && !result.dryRun) usage("Creation requires an output destination.");
    if (result.force && !result.output) usage("Force requires an explicit output destination.");
    if (result.output === "-" && result.json && !result.dryRun)
      usage("Binary stdout cannot be combined with JSON.");
    return result;
  }
  if (operation === "slides.import") {
    const allowed = [
      "--source",
      "--source-slides",
      "--theme-policy",
      "--dimension-policy",
      "--position",
      "--json",
      "--limit",
      "--output",
      "--in-place",
      "--force",
      "--dry-run"
    ];
    if ([...seen].some((option) => !allowed.includes(option)))
      usage("Option does not apply to slide import.");
    if (!result.source || !result.importing?.sourceSlides)
      usage("Import requires source and source slides.");
    if (positionals[0] === "-" && result.source === "-") usage("Only one input may consume stdin.");
    if (result.output === result.source && result.output !== "-")
      usage("Import output cannot replace its source.");
    if (result.inPlace && positionals[0] === result.source)
      usage("Import in-place destination must differ from source.");
  } else if (operation === "slides.add") {
    const allowed = [
      "--layout",
      "--position",
      "--name",
      "--hidden",
      "--follow-master-background",
      "--title",
      "--body",
      "--placeholders-json",
      "--json",
      "--limit",
      "--output",
      "--in-place",
      "--force",
      "--dry-run"
    ];
    if ([...seen].some((option) => !allowed.includes(option)))
      usage("Option does not apply to slide addition.");
    if (positionals.length !== 1 || !positionals[0])
      usage("Slide addition requires exactly one input.");
    result.input = positionals[0];
    if (!result.addition?.layout) usage("Slide addition requires --layout.");
  } else if (slideMutation) {
    const allowed = [
      "--selection-json",
      "--slide",
      "--select",
      "--scope",
      "--all",
      "--allow-empty",
      "--json",
      "--limit",
      "--output",
      "--in-place",
      "--force",
      "--dry-run",
      ...(operation === "slides.remove" ? ["--reference-policy"] : ["--position"]),
      ...(operation === "slides.set" ? ["--name", "--hidden"] : [])
    ];
    if ([...seen].some((option) => !allowed.includes(option)))
      usage("Option does not apply to this slide mutation.");
    if (
      seen.has("--selection-json") &&
      ["--slide", "--select", "--scope", "--all"].some((flag) => seen.has(flag))
    )
      usage("Structured and simple selectors cannot be combined.");
    if (!seen.has("--selection-json") && result.slide === undefined && !result.token && !result.all)
      usage("Slide mutation requires a selector or --all.");
    if (
      operation !== "slides.remove" &&
      (!result.mutation ||
        ((operation === "slides.move" || operation === "slides.duplicate") &&
          result.mutation.position === undefined))
    )
      usage("Slide mutation requires update fields; move/duplicate require --position.");
    if (result.scope !== undefined && result.scope !== "slides")
      usage("Slide mutations require slides scope.");
  } else if (operation !== "inspect" && !xml) {
    if ([...seen].some((option) => option !== "--json"))
      usage("Selection options require inspect.");
    if (
      (operation === "schema" || operation === "help") &&
      [
        ...Object.keys(fieldSchemas),
        ...Object.keys(membershipSchemas),
        ...Object.keys(settingsSchemas),
        ...Object.keys(masterSchemas),
        ...Object.keys(shapeSchemas),
        "create",
        "inspect",
        "slides.add",
        "slides.move",
        "slides.set",
        "slides.remove",
        "slides.duplicate",
        "slides.import",
        "slides.merge",
        "slides.split",
        "text.get",
        "text.replace",
        "text.fit",
        "text.frames.set",
        "text.frames.get",
        "text.frames.list",
        "text.paragraphs.set",
        "text.paragraphs.get",
        "text.paragraphs.list",
        "text.runs.set",
        "text.runs.get",
        "text.runs.list",
        "xml.get",
        "xml.set"
      ].includes(positionals.join("."))
    ) {
      result.schemaPath = positionals.join(".");
      return result;
    }
    if (positionals.length) usage("Unexpected input.");
    return result;
  }
  if (positionals.length !== 1) usage("Inspection requires exactly one input.");
  result.input = positionals[0]!;
  if (result.input.length === 0) usage("Input path must not be empty.");
  if (
    result.token &&
    ["--slide", "--shape", "--part", "--scope", "--all"].some((option) => seen.has(option))
  )
    usage("Opaque and simple selectors cannot be combined.");
  if (result.part && result.slide !== undefined)
    usage("Part and slide selectors cannot be combined.");
  if (result.shape && result.slide === undefined && !result.part)
    usage("Shape selection requires an owning slide or part.");
  if (result.slide !== undefined && result.scope !== undefined && result.scope !== "slides")
    usage("Slide positions require slides scope.");
  const mutationOptions = ["--file", "--output", "--in-place", "--force", "--dry-run"];
  if (
    operation !== "xml.set" &&
    operation !== "slides.add" &&
    operation !== "slides.import" &&
    !slideMutation &&
    mutationOptions.some((option) => seen.has(option))
  )
    usage("Publication options require xml set.");
  if (
    !xml &&
    operation !== "slides.add" &&
    operation !== "slides.import" &&
    !slideMutation &&
    result.limits
  )
    usage("Limit overrides require XML operations or slides add.");
  if (operation !== "xml.get" && result.pretty) usage("Pretty output requires xml get.");
  if (xml) {
    if (result.slide !== undefined || result.shape || result.all)
      usage("XML operations require one part selector.");
    if (!result.part && !result.token) usage("XML operations require a part or opaque selector.");
  }
  if (
    operation === "xml.set" ||
    operation === "slides.add" ||
    operation === "slides.import" ||
    slideMutation
  ) {
    if (operation === "xml.set" && !result.file) usage("XML replacement requires --file.");
    if (result.input === "-" && result.file === "-") usage("Only one input may consume stdin.");
    if (result.inPlace && result.input === "-") usage("Stdin cannot be edited in place.");
    if (result.inPlace && result.output) usage("Output and in-place cannot be combined.");
    if (!result.dryRun && !result.inPlace && !result.output)
      usage("Mutation requires a destination.");
    if (result.force && !result.output) usage("Force requires an explicit output destination.");
    if (result.output === result.input && result.output !== "-")
      usage("Replacing input requires --in-place.");
    if (result.output === "-" && result.json && !result.dryRun)
      usage("Binary stdout cannot be combined with JSON.");
  }
  return result;
}

function selected(
  index: Awaited<ReturnType<typeof readSelectionIndex>>,
  args: Arguments
): readonly SelectionRecord[] {
  if (args.token) return index.select({ token: args.token });
  const scope = args.scope ?? "slides";
  const all = args.all ?? false;
  if (args.slide !== undefined) {
    const slides = index.select({
      kind: "slide",
      position: { coordinateSystem: "one-based", value: args.slide }
    });
    if (!args.shape) return slides;
    return index.select({ kind: "object", owner: slides[0]!.part, name: args.shape, scope, all });
  }
  if (args.part) {
    if (args.shape)
      return index.select({ kind: "object", owner: args.part, name: args.shape, scope, all });
    return index.select({ kind: "part", part: args.part, scope, all });
  }
  return scope === "slides"
    ? index.slides
    : index.parts.filter((record) => record.location.scope === scope);
}

function success(
  operation: string,
  data: unknown,
  records: readonly SelectionRecord[] = []
): Extract<OfficeResult<unknown>, { readonly ok: true }> {
  return {
    version: 1,
    operation,
    ok: true,
    data,
    warnings: [],
    errors: [],
    affected: 0,
    locations: records.map((record) => record.location)
  };
}

function outputLimitFailure(operation: string, json: boolean): PptxCommandOutput {
  const failure: OfficeResult<never> = {
    version: 1,
    operation,
    ok: false,
    data: null,
    warnings: [],
    errors: [
      { code: "resource-limit", message: "Output limit exceeded.", context: { phase: "publish" } }
    ],
    affected: 0,
    locations: []
  };
  const message = new TextEncoder().encode(
    json ? `${JSON.stringify(failure)}\n` : "pptx: resource-limit: Output limit exceeded.\n"
  );
  return {
    exitCode: 4,
    stdout: json ? message : new Uint8Array(),
    stderr: json ? new Uint8Array() : message
  };
}

async function transferLocations(bytes: Uint8Array, budget: SlideTransferBudget) {
  const relationshipNamespaces = [
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "http://purl.oclc.org/ooxml/officeDocument/relationships"
  ];
  const reader = await budget.open(bytes);
  const graph = budget.graph(reader);
  const roots = graph
    .outgoing("/")
    .filter((edge) =>
      relationshipNamespaces.some((namespace) => edge.type === `${namespace}/officeDocument`)
    );
  const root = roots.length === 1 ? roots[0]!.targetPart : undefined;
  if (!root) throw new OfficeError("invalid-opc", "Presentation part is missing.", "index");
  const relationshipNamespace = roots[0]!.type.slice(0, -"/officeDocument".length);
  const xml = budget.xml(reader.get(root));
  const fingerprint = Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
  const locations = xml.root.children
    .filter(
      (node) =>
        node.name.namespace === xml.root.name.namespace && node.name.localName === "sldIdLst"
    )
    .flatMap((node) => node.children)
    .map((node) => {
      const id = node.attributes.find(
        (attribute) => attribute.name.namespace === "" && attribute.name.localName === "id"
      )?.value;
      const reference = node.attributes.find(
        (attribute) =>
          attribute.name.namespace === relationshipNamespace && attribute.name.localName === "id"
      )?.value;
      const owner = graph
        .outgoing(root)
        .find(
          (edge) => edge.id === reference && edge.type === `${relationshipNamespace}/slide`
        )?.targetPart;
      if (!id || !owner || !reader.has(owner))
        throw new OfficeError("invalid-opc", "Referenced slide is missing.", "index");
      return {
        fingerprint,
        scope: "slides" as const,
        owner: root,
        objectId: String(Number(id)),
        coordinateSystem: "identity" as const
      };
    });
  return { fingerprint, locations };
}

async function execute(
  request: PptxCommandRequest,
  options: PptxCommandEngineOptions
): Promise<PptxCommandOutput> {
  const output = { json: false, operation: "inspect" };
  let result: OfficeResult<unknown>;
  let exitCode = 0;
  let human: string | undefined;
  let binary: Uint8Array | undefined;
  let publication: PptxPublicationRequest | undefined;
  let publications: readonly PptxPublicationRequest[] | undefined;
  let splitManifest: readonly {
    path: string;
    sha256: string;
    bytes: number;
    sourceSlide: number;
    sourceLocation: SelectionRecord["location"];
  }[] = [];
  let allowPartialOutput = false;
  try {
    request.signal.throwIfAborted();
    if (!Array.isArray(request.args)) usage("Arguments must be byte arrays.");
    const args = parse(request.args, options.maxArgumentBytes, output);
    if (args.limits) {
      const validation = options.context.validationLimits;
      const ceilings: Record<string, number> = {
        maxBytes: Math.min(
          options.context.limits.maxBytes,
          options.context.archiveLimits.maxArchiveBytes,
          options.context.xmlLimits.maxBytes,
          validation?.maxBytes ?? Infinity
        ),
        maxNodes: Math.min(options.context.xmlLimits.maxNodes, validation?.maxNodes ?? Infinity),
        maxDepth: Math.min(options.context.xmlLimits.maxDepth, validation?.maxDepth ?? Infinity),
        maxOutputBytes: options.maxOutputBytes
      };
      for (const [name, value] of Object.entries(args.limits)) {
        if (value > ceilings[name]! || (name === "maxOutputBytes" && value < 512))
          usage("Limits must lower trusted ceilings; output requires at least 512 bytes.");
      }
      const loweredXml = Object.fromEntries(
        Object.entries(args.limits).filter(([key]) => key !== "maxOutputBytes")
      );
      options = {
        ...options,
        maxOutputBytes: args.limits.maxOutputBytes ?? options.maxOutputBytes,
        context: {
          ...options.context,
          limits: {
            ...options.context.limits,
            maxBytes: args.limits.maxBytes ?? options.context.limits.maxBytes
          },
          xmlLimits: { ...options.context.xmlLimits, ...loweredXml },
          ...(validation ? { validationLimits: { ...validation, ...loweredXml } } : {})
        }
      };
    }
    output.json = args.json;
    output.operation = args.operation;
    const operation = args.operation;
    if (args.operation === "help") {
      const usage =
        args.schemaPath === "text.fit"
          ? "Usage: pptx text fit INPUT --metrics JSON [selection] [output]\n" +
            "Selection: --slide N --shape NAME | --select TOKEN | --all\n" +
            "Output: --output PATH | --in-place | --dry-run\n" +
            "--font-family NAME --min-size N --max-size N\n" +
            "--bold true|false --italic true|false --wrap true|false\n" +
            "--margin-left LENGTH --margin-right LENGTH\n" +
            "--margin-top LENGTH --margin-bottom LENGTH --line-spacing MULTIPLIER\n" +
            "--json --allow-empty --force --scope SCOPE --limit NAME=VALUE\n" +
            "Defaults: Calibri, 1..18pt, regular, wrap, line spacing 1.\n" +
            "Supplied scalar metrics; horizontal single-column shapes with local extents.\n" +
            "No host font discovery. Platform rendering may differ.\n"
          : args.schemaPath?.startsWith("text.frames.")
            ? frameHelp
            : args.schemaPath?.startsWith("text.paragraphs.")
              ? paragraphHelp
              : args.schemaPath?.startsWith("text.runs.")
                ? runHelp
                : help;
      const resolvedUsage = [
        "shapes.move",
        "shapes.align",
        "shapes.distribute",
        "shapes.duplicate"
      ].includes(args.schemaPath ?? "")
        ? "Usage: pptx shapes move|align|distribute|duplicate INPUT [selection] --coordinate-system slide|group [output]\n" +
          "Selection: --shapes JSON Location array, or --slide N [--shape NAME | --all], or --select TOKEN.\n" +
          "Move: --order front|back|forward|backward OR --position N (one-based).\n" +
          "Align: --alignment left|center|right|top|middle|bottom. Distribute: --axis horizontal|vertical.\n" +
          "Duplicate: --offset-x LENGTH --offset-y LENGTH (explicit units, signed offsets).\n" +
          "Hidden siblings participate; locked selections fail. Mixed slides or parent groups fail.\n" +
          "Output: --output PATH | --in-place | --dry-run; --force, --json, --limit NAME=VALUE.\n"
        : args.schemaPath?.startsWith("shapes.paths.")
          ? "Usage: pptx shapes paths list|get|add|set INPUT [selection] [path] [output]\n" +
            "Read: list|get INPUT [selection]. Add/set require --path JSON or --vertices JSON.\n" +
            "Path: {unit:emu,width,height,commands:[move|line|quadratic|cubic|close]}\n" +
            "Coordinates: integer local EMUs, -2147483647..2147483647; viewport 1..2147483647.\n" +
            "At most 4096 commands; explicit closure; command order preserved without winding evaluation.\n" +
            "Alternatively --vertices JSON --close true|false uses {x,y} local EMU vertices and a derived viewport.\n" +
            "Add placement: --left LENGTH --top LENGTH --width LENGTH --height LENGTH.\n" +
            "Add accepts shape name, text, paint and metadata properties. Lengths require emu/in/cm/mm/pt.\n" +
            "Selection: --slide N [--shape NAME] | --part URI --scope SCOPE | --select TOKEN.\n" +
            "Set: selects one shape unless --all; --allow-empty accepts zero matches.\n" +
            "Scopes: slides (default), layouts, masters; shared requires --part URI.\n" +
            "Output: --output PATH | --in-place | --dry-run; --force --json --limit NAME=VALUE.\n" +
            "Unsupported formulas, arcs and arbitrary existing geometry are preserve-only.\n"
          : ["shapes.group", "shapes.ungroup"].includes(args.schemaPath ?? "")
            ? "Usage: pptx shapes group|ungroup INPUT --tolerance LENGTH [selection] [output]\n" +
              "Group: --shapes JSON array of at least two inspected Location objects.\n" +
              "Shapes must be distinct contiguous siblings; original IDs and z-order are retained.\n" +
              "Ungroup: --slide N --shape NAME | --select TOKEN; selects one group.\n" +
              "Selection: --part URI --scope SCOPE. Exact cardinality; --all/--allow-empty are unsupported.\n" +
              "Tolerance is explicit nonnegative EMU precision using emu/in/cm/mm/pt lengths.\n" +
              "Identity groups preserve child XML; transformed ungrouping supports nested groups and rectangles\n" +
              "without text, styles or strokes.\n" +
              "Transformed ungrouping supports quarter-turn rotation chains only.\n" +
              "World geometry must remain within tolerance; unsupported geometry and references fail.\n" +
              "Output: --output PATH | --in-place | --dry-run; --force --json --limit NAME=VALUE.\n"
            : args.schemaPath?.startsWith("shapes.")
              ? "Usage: pptx shapes list|get|add|set INPUT [selection] [properties] [output]\n" +
                "Selection: --slide N --shape NAME | --select TOKEN; --part URI --scope SCOPE\n" +
                "Scopes: slides (default), layouts, masters; shared requires a part.\n" +
                "Add: --kind text-box|PRESET --left LENGTH --top LENGTH --width LENGTH --height LENGTH\n" +
                "Properties: --name TEXT --text TEXT --title TEXT --description TEXT --alt-text TEXT\n" +
                "  --locked true|false|null --rotation DEGREES --fill RGB --line-color RGB --line-width LENGTH\n" +
                "  --flip-horizontal true|false --flip-vertical true|false\n" +
                "  Geometry uses parent coordinates; inspection corners use slide EMUs.\n" +
                "Lengths require emu/in/cm/mm/pt. Presets use enum names or numeric values from schema.\n" +
                "Null clears direct title/description/lock; null fill/line color disables fill/line.\n" +
                "Omitted values stay unchanged.\n" +
                "Null line width restores inherited width.\n" +
                "Fill/line color solid selects solid fill; existing solid colors are retained.\n" +
                "Shape IDs are read-only. Unsupported geometry and advanced formatting are preserve-only.\n" +
                "Output: --output PATH | --in-place | --dry-run; --force --json --limit NAME=VALUE\n" +
                "Set: --all edits every match; --allow-empty accepts zero matches.\n"
              : args.schemaPath?.startsWith("fields.")
                ? "Usage: pptx fields list|get|set|add|remove INPUT [options]\n" +
                  "Selection: --slide N --shape NAME | --select TOKEN\n" +
                  "           --scope SCOPE --json --limit NAME=VALUE\n" +
                  "Mutation:  --all --allow-empty\n" +
                  "Output:    --output PATH | --in-place | --dry-run; --force\n" +
                  "Set/add:   --kind slide-number|date|footer|header\n" +
                  "           --update preserve|explicit --text TEXT --timestamp UTC\n" +
                  "Add requires --kind and one text body; appends to its last paragraph.\n" +
                  "Preserve is default: retains the cache (empty on add), rejects text/time.\n" +
                  "Explicit requires text; date fields also require a caller UTC timestamp.\n" +
                  "No field evaluation, automatic numbering or inherited-content flattening.\n" +
                  "List/get are read-only; get requires one field. Remove accepts no policy.\n"
                : usage;
      result = success(operation, { usage: resolvedUsage });
      human = resolvedUsage;
    } else if (args.operation === "version") {
      result = success(operation, { version: 1, profile: "selectors" });
      human = "pptx selectors v1\n";
    } else if (args.operation === "schema")
      result = success(operation, {
        version: 1,
        operations: Object.fromEntries(
          Object.entries({
            ...fieldSchemas,
            ...membershipSchemas,
            ...settingsSchemas,
            ...masterSchemas,
            ...shapeSchemas,
            create: createSchema,
            inspect: inspectSchema,
            "text.get": textGetSchema,
            "text.replace": textReplaceSchema,
            "text.fit": textFitSchema,
            "text.frames.set": textFramesSetSchema,
            "text.frames.get": textFramesGetSchema,
            "text.frames.list": textFramesListSchema,
            "text.paragraphs.set": textParagraphsSetSchema,
            "text.paragraphs.get": textParagraphsGetSchema,
            "text.paragraphs.list": textParagraphsListSchema,
            "text.runs.set": textRunsSetSchema,
            "text.runs.get": textRunsGetSchema,
            "text.runs.list": textRunsListSchema,
            "slides.add": slidesAddSchema,
            "slides.move": slidesMoveSchema,
            "slides.set": slidesSetSchema,
            "slides.remove": slidesRemoveSchema,
            "slides.duplicate": slidesDuplicateSchema,
            "slides.import": slidesImportSchema,
            "slides.merge": slidesMergeSchema,
            "slides.split": slidesSplitSchema,
            "xml.get": xmlGetSchema,
            "xml.set": xmlSetSchema
          }).filter(([path]) => !args.schemaPath || path === args.schemaPath)
        )
      });
    else if (args.operation === "capabilities")
      result = success(operation, {
        features: {
          shapeGroups: {
            supported: true,
            level: "edit",
            operations: ["shapes.group", "shapes.ungroup"],
            subset:
              "Contiguous sibling grouping and single-group ungrouping with explicit EMU tolerance; retain original shape IDs, world geometry and z-order. Identity groups preserve child XML; transformed ungrouping requires rectangles without text, styles or strokes, nested groups and quarter-turn rotation chains. Unsupported geometry and affected references are rejected."
          },
          fields: {
            supported: true,
            level: "edit",
            operations: Object.keys(fieldSchemas),
            subset:
              "Inline field caches only; preserve or explicit caller text/time, no automatic field evaluation. Shared inherited fields require explicit scope."
          },
          textFit: {
            supported: true,
            operation: "text.fit",
            level: "edit",
            subset:
              "Supplied scalar metrics; horizontal single-column shapes with local extents; inclusive integer point bounds, margins, wrap, explicit line spacing. No host font discovery, bullets, indentation or advanced shaping."
          },
          textFrames: {
            level: "edit",
            operation: "text.frames.set",
            selectors: ["slide", "shape", "select"],
            subset:
              "Shape text frames only (table cells excluded): insets, vertical anchor, columns, wrapping, vertical text, rotation and autofit metadata; null clears direct metadata. No host measurement or text-fit calculation. Table/cell/paragraph/run selectors are unavailable."
          },
          textParagraphs: {
            level: "edit",
            operation: "text.paragraphs.set",
            selectors: ["slide", "shape", "paragraph", "select"],
            subset:
              "Local alignment, margins, spacing, indentation, list levels, bullets, numbering, RTL and tabs; null restores inheritance. No line wrapping."
          },
          textRuns: {
            supported: true,
            operation: "text.runs.set",
            selectors: ["slide", "shape", "paragraph", "run", "select"]
          },
          textReplace: {
            level: "edit",
            subset:
              "Literal Unicode-safe replacement across adjacent runs within paragraphs; field and break boundaries stop matches. Explicit first/all/occurrence, first-run style inheritance with optional bold/italic overrides, unaffected formatting and hyperlinks retained; no normalization or fine-grained selectors."
          },
          text: {
            level: "read",
            subset:
              "Paragraphs, runs, soft breaks and cached fields in structural slide-list and shape-tree order, including groups, table cells, hidden slides and empty strings. Explicit notes, layouts and masters scopes do not imply visual reading order. Fine-grained table/cell/paragraph/run selectors are unavailable."
          },
          layouts: {
            level: "edit",
            subset:
              "Inspect registered IDs, master associations and placeholders; create, rename, set supported properties, remove unreferenced layouts, and apply with explicit type-index or reject-unmatched policy. Missing placeholder type/index default to obj/0. Ambiguous mappings reject; local content and formatting remain intact. Shared edits require layouts/shared scope and report dependent slides."
          },
          masters: {
            level: "edit",
            subset:
              "Inspect, create and rename masters, append text boxes, edit supported selected shape properties and solid RGB backgrounds or reset to inheritance. Shapes also expose documented presets. Explicit masters/shared scope; report dependent slides while preserving local overrides. Layout associations require layouts/shared scope. Shared themes are retained, ambiguous theme selection requires an explicit URI."
          },
          themes: {
            level: "edit",
            subset:
              "Inspect and edit existing palette and font slots in base themes and overrides; rename base themes. Unsupported theme payloads are preserved. Requires explicit shared scope."
          },
          backgrounds: {
            level: "edit",
            subset:
              "Inspect and edit solid RGB, linear RGB gradients, PNG/JPEG picture signatures, RGB placeholder style references and inherited backgrounds. Image decoding is not performed. Slide changes are local; layouts and masters require explicit scope. Unsupported effects are preserved."
          },
          settings: {
            level: "edit",
            subset:
              "Presentation and notes canvas dimensions/orientation, slide-number start, slideshow loop and speaker/window/kiosk mode. Canvas-only resize is the default. Explicit scaling supports unrotated explicit shape and group geometry on slides, layouts and masters without resizing fonts; inherited transforms, animations, conditional drawings and charts are rejected. Grid, view, print and unrequested vendor settings are preserved."
          },
          creation: {
            level: "edit",
            subset:
              "Original macro-free Transitional pptx, potx and ppsx; explicit size and metadata; blank master/layout and structured text slides. Strict and supplied templates are rejected."
          },
          selectors: { level: "read", subset: "slide, part and drawing object locations" },
          inventory: {
            level: "read",
            subset:
              "ordered slides, owner graph, part hashes, media parts, slide visibility and read-only textStyles with explicit/inherited/absent/unresolved values and source provenance; text styles cover bold, italic, point size, theme font variants and untransformed RGB/scheme colors; other semantic content remains uninspected"
          },
          slides: {
            level: "edit",
            subset:
              "Insert at a validated position using an explicit layout/master; populate unambiguous type/index placeholders. Move ordered slides while retaining IDs; set names and visibility. Remove slides with explicit known-reference removal policy; reject unresolved opaque references and retain shared resources. Duplicate slide-local shapes and notes with fresh identities; clone mutable dependent resources and reject unsupported references. Layout reassignment uses layouts apply with explicit placeholder policy; background changes are unavailable."
          },
          sections: {
            level: "edit",
            subset:
              "Create, rename, reorder and remove sections with contiguous nonoverlapping membership; stable IDs and supported extension preservation."
          },
          shows: {
            level: "edit",
            subset:
              "Create, rename, replace ordered membership and remove custom shows; stable IDs, hidden slides and existing repeated entries are preserved."
          },
          slideImport: {
            level: "edit",
            subset:
              "F08 subset: ordered source slides with supported dependency closure and deterministic collision remapping; source appearance is the default. Dimension conflicts reject unless destination size with unchanged source coordinates is explicit. Destination theme mapping, conflicting notes masters, tables/global table styles, embedded fonts, unequal presentation text defaults, unknown extension references, mixed dialects and links to unselected slides are rejected."
          },
          slideAssembly: {
            level: "edit",
            subset:
              "Merge ordered sources using import closure and combined budgets. Split selected slides into independent packages with deterministic manifests; outward slide navigation is rejected. Multiple outputs require an atomic adapter or explicit partial-output mode."
          },
          editing: { level: "reject", reason: "Other semantic model editing is not exposed." },
          customPaths: {
            level: "edit",
            subset:
              "Local integer EMU move/line/quadratic/cubic commands, explicit closure and retained command order without winding evaluation; 4096 commands, coordinates bounded to ±2147483647. Existing unsupported custom geometry and formulas are preserved; geometry-engine edits are rejected."
          },
          shapeSelection: {
            level: "edit",
            operations: ["shapes.move", "shapes.align", "shapes.distribute", "shapes.duplicate"],
            subset:
              "Explicit slide or group coordinates; distinct siblings; hidden objects participate and locked selections reject. Stable drawing order resolves ties. Alignment uses selection bounds, distribution preserves endpoints with equal edge gaps, and duplication requires signed offsets with fresh IDs and supported reference remapping. Unsupported geometry or references reject without publication."
          },
          shapes: {
            level: "edit",
            subset:
              "Text boxes and documented presets on slides, layouts and masters. Names, read-only allocated IDs, title/description, locks and basic solid fill/line. Position, size, rotation and flips also edit pictures, connectors, groups and graphic frames. Stored geometry uses parent coordinates; inspection projects explicit nested transforms into slide EMUs. Missing inherited geometry is not resolved. Group/ungroup requires explicit tolerance and supported geometry. Advanced formatting remains unavailable."
          },
          xml: {
            level: options.context.validationLimits ? "edit" : "reject",
            subset:
              "bounded XML read; presentation and slide replacement retains element structure, opaque content and resource bindings; partial semantic validation; signed, protected and dialect-changing edits rejected",
            ...(options.context.validationLimits
              ? {}
              : { reason: "Explicit XML validation limits are unavailable." })
          }
        },
        io: { input: "explicit-vfs-or-stdin", network: false, nativeRuntime: false }
      });
    else if (
      ["fields.set", "fields.add", "fields.remove"].includes(args.operation) ||
      args.operation === "text.replace" ||
      args.operation === "text.runs.set" ||
      args.operation === "text.paragraphs.set" ||
      args.operation === "text.frames.set" ||
      args.operation === "text.fit"
    ) {
      const context = { ...options.context, signal: request.signal };
      const scope = args.token ? decodeSelectionToken(args.token).scope : args.scope;
      const bytes = await request.readInput(
        args.input!,
        Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
      );
      const selectedText = {
        ...(args.allowEmpty ? { allowEmpty: true } : {}),
        ...(scope === undefined ? {} : { scope: scope as TextScope }),
        ...(args.token
          ? { select: { token: args.token } }
          : args.slide === undefined
            ? {}
            : {
                select: {
                  kind: "slide" as const,
                  position: { coordinateSystem: "one-based" as const, value: args.slide }
                }
              }),
        ...(args.shape === undefined ? {} : { shape: args.shape })
      };
      const changed = args.operation.startsWith("fields.")
        ? await mutateFields(
            bytes,
            args.operation.slice(7) as "set" | "add" | "remove",
            { ...args.fieldEdit, ...selectedText, ...(args.all ? { all: true } : {}) },
            context
          )
        : args.operation === "text.fit"
          ? await fitTextFrames(
              bytes,
              { ...args.fitEdit!, ...selectedText, ...(args.all ? { all: true } : {}) },
              context
            )
          : args.operation === "text.frames.set"
            ? await mutateTextFrames(
                bytes,
                { ...args.frameEdit, ...selectedText, ...(args.all ? { all: true } : {}) },
                context
              )
            : args.operation === "text.paragraphs.set"
              ? await mutateTextParagraphs(
                  bytes,
                  { ...args.paragraphEdit, ...selectedText, ...(args.all ? { all: true } : {}) },
                  context
                )
              : args.operation === "text.runs.set"
                ? await mutateTextRuns(
                    bytes,
                    { ...args.runEdit, ...selectedText, ...(args.all ? { all: true } : {}) },
                    context
                  )
                : await replacePresentationText(
                    bytes,
                    {
                      ...selectedText,
                      ...(args.style === undefined ? {} : { style: args.style }),
                      find: args.find!,
                      with: args.with!,
                      ...(args.first ? { first: true } : {}),
                      ...(args.all ? { all: true } : {}),
                      ...(args.occurrence === undefined ? {} : { occurrence: args.occurrence })
                    },
                    context
                  );
      const dryRun = args.dryRun ?? false;
      result = {
        ...success(
          operation,
          args.operation.startsWith("fields.")
            ? {
                effects: changed.locations.map((location) => ({
                  location,
                  action: args.operation.slice(7),
                  feature: "F21"
                })),
                outputs: dryRun
                  ? []
                  : [
                      {
                        path: (args.inPlace ? args.input : args.output)!,
                        sha256: Array.from(sha256(changed.bytes), (byte) =>
                          byte.toString(16).padStart(2, "0")
                        ).join(""),
                        bytes: changed.bytes.length
                      }
                    ],
                fingerprint: dryRun
                  ? null
                  : Array.from(sha256(changed.bytes), (byte) =>
                      byte.toString(16).padStart(2, "0")
                    ).join("")
              }
            : args.operation === "text.fit"
              ? { frames: changed.affected, sizes: "sizes" in changed ? changed.sizes : [], dryRun }
              : args.operation === "text.frames.set"
                ? { frames: changed.affected, dryRun }
                : args.operation === "text.paragraphs.set"
                  ? { paragraphs: changed.affected, dryRun }
                  : args.operation === "text.runs.set"
                    ? { runs: changed.affected, dryRun }
                    : { replacements: changed.affected, dryRun }
        ),
        affected: changed.affected,
        locations: changed.locations
      };
      human = args.operation.startsWith("fields.")
        ? `${dryRun ? "Validated" : "Updated"} ${changed.affected} field(s)\n`
        : `${dryRun ? "Validated" : args.operation === "text.fit" ? "Fitted" : args.operation.endsWith(".set") ? "Updated" : "Replaced"} ${changed.affected} ${args.operation === "text.fit" || args.operation === "text.frames.set" ? "text frame(s)" : args.operation === "text.paragraphs.set" ? "paragraph(s)" : args.operation === "text.runs.set" ? "text run(s)" : "text match(es)"}\n`;
      const destination = args.inPlace ? args.input! : args.output;
      if (destination === "-" && !dryRun) binary = changed.bytes;
      else if (destination && destination !== "-") {
        if (!request.publishOutput)
          throw Object.assign(new Error("Output publication capability is unavailable."), {
            code: "publication-unsupported"
          });
        publication = {
          inputPath: args.input!,
          outputPath: destination,
          bytes: changed.bytes,
          originalBytes: bytes,
          inPlace: args.inPlace ?? false,
          force: args.force ?? false,
          dryRun
        };
      }
    } else if (
      args.operation === "fields.list" ||
      args.operation === "fields.get" ||
      args.operation === "text.get" ||
      args.operation === "text.runs.get" ||
      args.operation === "text.runs.list" ||
      args.operation === "text.paragraphs.get" ||
      args.operation === "text.paragraphs.list" ||
      args.operation === "text.frames.get" ||
      args.operation === "text.frames.list"
    ) {
      const context = { ...options.context, signal: request.signal };
      const scope = args.token ? decodeSelectionToken(args.token).scope : args.scope;
      const bytes = await request.readInput(
        args.input!,
        Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
      );
      const textOptions = {
        ...(scope === undefined ? {} : { scope: scope as TextScope }),
        ...(args.token
          ? { select: { token: args.token } }
          : args.slide === undefined
            ? {}
            : {
                select: {
                  kind: "slide" as const,
                  position: { coordinateSystem: "one-based" as const, value: args.slide }
                }
              }),
        ...(args.shape === undefined ? {} : { shape: args.shape })
      };
      const data = args.operation.startsWith("fields.")
        ? { fields: await readFields(bytes, textOptions, context) }
        : args.operation.startsWith("text.frames.")
          ? { frames: await readTextFrames(bytes, textOptions, context) }
          : args.operation.startsWith("text.paragraphs.")
            ? {
                paragraphs: await readTextParagraphs(
                  bytes,
                  { ...textOptions, ...args.paragraphEdit },
                  context
                )
              }
            : args.operation !== "text.get"
              ? { runs: await readTextRuns(bytes, { ...textOptions, ...args.runEdit }, context) }
              : await readPresentationText(bytes, textOptions, context);
      if (args.operation === "fields.get" && "fields" in data && data.fields.length !== 1)
        throw new SelectionError(data.fields.length ? "ambiguous-selection" : "missing-selection");
      if (args.operation === "text.frames.get" && "frames" in data && data.frames.length !== 1)
        throw new SelectionError(data.frames.length ? "ambiguous-selection" : "missing-selection");
      if (args.operation === "text.runs.get" && "runs" in data && data.runs.length !== 1)
        throw new SelectionError(data.runs.length ? "ambiguous-selection" : "missing-selection");
      if (
        args.operation === "text.paragraphs.get" &&
        "paragraphs" in data &&
        data.paragraphs.length !== 1
      )
        throw new SelectionError(
          data.paragraphs.length ? "ambiguous-selection" : "missing-selection"
        );
      result = {
        ...success(
          operation,
          "fields" in data
            ? {
                items: data.fields.map((field) => ({
                  location: field.location,
                  kind: field.kind ?? "unknown",
                  name: field.fieldId,
                  fields: [
                    {
                      name: "fieldType",
                      value:
                        field.fieldType === null
                          ? { type: "null", value: null }
                          : { type: "string", value: field.fieldType }
                    },
                    { name: "cachedText", value: { type: "string", value: field.cachedText } },
                    { name: "paragraph", value: { type: "number", value: field.paragraph } },
                    { name: "inline", value: { type: "number", value: field.inline } },
                    { name: "coordinateSystem", value: { type: "string", value: "zero-based" } }
                  ]
                }))
              }
            : data
        ),
        locations:
          "fields" in data
            ? data.fields.map((field) => field.location)
            : "frames" in data
              ? data.frames.map((frame) => frame.location)
              : "segments" in data
                ? data.segments.map((segment) => segment.location)
                : "paragraphs" in data
                  ? data.paragraphs.map((paragraph) => paragraph.location)
                  : data.runs.map((run) => run.location)
      };
      human =
        "text" in data
          ? data.text
          : JSON.stringify(
              "fields" in data
                ? data.fields
                : "frames" in data
                  ? data.frames
                  : "paragraphs" in data
                    ? data.paragraphs
                    : data.runs
            );
    } else if (Object.hasOwn(shapeSchemas, args.operation)) {
      const context = { ...options.context, signal: request.signal };
      const bytes = await request.readInput(
        args.input!,
        Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
      );
      const selection: ShapeSelection = {
        ...(args.scope === undefined ? {} : { scope: args.scope }),
        ...(args.slide === undefined ? {} : { slide: args.slide }),
        ...(args.part === undefined ? {} : { part: args.part }),
        ...(args.shape === undefined ? {} : { shape: args.shape }),
        ...(args.token === undefined ? {} : { select: args.token }),
        ...(args.all === undefined ? {} : { all: args.all }),
        ...(args.allowEmpty === undefined ? {} : { allowEmpty: args.allowEmpty })
      };
      if (args.operation.endsWith(".list") || args.operation.endsWith(".get")) {
        const records = args.operation.startsWith("shapes.paths.")
          ? await readShapePaths(bytes, selection, context)
          : await readShapes(bytes, selection, context);
        if (args.operation.endsWith(".get") && records.length !== 1)
          throw new SelectionError(
            records.length ? "ambiguous-selection" : "missing-selection",
            records.map((x) => x.location)
          );
        result = { ...success(operation, { records }), locations: records.map((x) => x.location) };
        human = records
          .map(
            (x) =>
              `${x.shapeId}\t${x.name}\t${"kind" in x ? (x.kind ?? "unsupported") : x.path ? "path" : "unsupported"}\n`
          )
          .join("");
      } else {
        const mutation = args.selectionEdit
          ? await mutateShapeSelection(bytes, args.selectionEdit, context)
          : args.operation === "shapes.group"
            ? await groupShapes(
                bytes,
                { ...selection, shapes: args.shapes!, tolerance: args.tolerance! },
                context
              )
            : args.operation === "shapes.ungroup"
              ? await ungroupShape(bytes, { ...selection, tolerance: args.tolerance! }, context)
              : args.operation === "shapes.paths.add"
                ? await addShapePath(
                    bytes,
                    { ...selection, path: args.path!, update: args.shapeEdit! },
                    context
                  )
                : args.operation === "shapes.paths.set"
                  ? await setShapePath(bytes, { ...selection, path: args.path! }, context)
                  : args.operation === "shapes.add"
                    ? await addShape(bytes, { ...selection, update: args.shapeEdit! }, context)
                    : await mutateShapes(bytes, { ...selection, update: args.shapeEdit! }, context);
        const after = await readSelectionIndex(mutation.bytes, context);
        const dryRun = args.dryRun ?? false;
        const destination = args.inPlace ? args.input! : args.output;
        const changed = after.objects.filter((x) =>
          mutation.records.some((r) => r.part === x.part && r.id === x.id)
        );
        result = {
          ...success(
            operation,
            {
              part: mutation.part,
              dryRun,
              affectedSlides: mutation.affectedSlides,
              effects: changed.map((x) => ({
                location: x.location,
                action:
                  args.operation.endsWith(".add") || args.operation === "shapes.duplicate"
                    ? "add"
                    : "set",
                feature: args.selectionEdit
                  ? "F25"
                  : ["shapes.group", "shapes.ungroup"].includes(args.operation)
                    ? "F24"
                    : args.operation.startsWith("shapes.paths.")
                      ? "F23"
                      : "F22"
              })),
              outputs: dryRun
                ? []
                : [{ path: destination!, sha256: after.fingerprint, bytes: mutation.bytes.length }],
              fingerprint: dryRun ? null : after.fingerprint
            },
            changed
          ),
          affected: mutation.affected
        };
        human = `${dryRun ? "Validated" : "Updated"} ${mutation.affected} shape(s)\n`;
        if (destination === "-" && !dryRun) binary = mutation.bytes;
        else if (destination && destination !== "-") {
          if (!request.publishOutput)
            throw Object.assign(new Error("Output publication capability is unavailable."), {
              code: "publication-unsupported"
            });
          publication = {
            inputPath: args.input!,
            outputPath: destination,
            bytes: mutation.bytes,
            originalBytes: bytes,
            inPlace: args.inPlace ?? false,
            force: args.force ?? false,
            dryRun
          };
        }
      }
    } else if (Object.hasOwn(masterSchemas, args.operation)) {
      const context = { ...options.context, signal: request.signal };
      const bytes = await request.readInput(
        args.input!,
        Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
      );
      const index = await readSelectionIndex(bytes, context);
      const editingTheme = args.operation.startsWith("themes.");
      const editingBackground = args.operation.startsWith("backgrounds.");
      const themeRecords = editingTheme ? await readThemes(bytes, context) : [];
      const editingLayout = args.operation.startsWith("layouts.");
      const applyingLayout = args.operation === "layouts.apply";
      const scope = editingTheme
        ? "shared"
        : editingBackground
          ? (args.scope ?? "slides")
          : applyingLayout
            ? "slides"
            : editingLayout
              ? "layouts"
              : "masters";
      let selectedShape = args.shape;
      let targets = (applyingLayout ? index.slides : index.parts).filter((record) =>
        editingTheme
          ? themeRecords.some((theme) => theme.part === record.part)
          : editingBackground && scope === "shared"
            ? ["slides", "layouts", "masters"].includes(record.scope)
            : record.scope === scope
      );
      if (args.part) targets = targets.filter((record) => record.part === args.part);
      else if (args.slide !== undefined) {
        const slide = index.inventory.slides.find((record) => record.position === args.slide);
        targets = targets.filter((record) =>
          editingTheme
            ? themeRecords.some(
                (theme) => theme.part === record.part && theme.affectedSlides.includes(args.slide!)
              )
            : record.part ===
              (applyingLayout || (editingBackground && scope === "slides")
                ? slide?.part
                : editingLayout || (editingBackground && scope === "layouts")
                  ? slide?.layout
                  : slide?.master)
        );
      } else if (args.token) {
        const selectedRecords = index.select({ token: args.token });
        if (
          selectedRecords.some((record) =>
            editingTheme
              ? !themeRecords.some((theme) => theme.part === record.part)
              : scope !== "shared" && record.scope !== scope
          )
        )
          throw new SelectionError("invalid-selection");
        if (selectedRecords.some((record) => record.kind === "object")) {
          if (
            !["masters.set", "layouts.set", "shapes.set"].includes(args.operation) ||
            selectedRecords.length !== 1
          )
            throw new SelectionError("invalid-selection");
          selectedShape = selectedRecords[0]!.id;
        }
        targets = targets.filter((record) =>
          selectedRecords.some((selectedRecord) => selectedRecord.part === record.part)
        );
      }
      const addingMaster = args.operation === "masters.add";
      const addingLayout = args.operation === "layouts.add";
      const adding = addingMaster || addingLayout;
      const removingLayout = args.operation === "layouts.remove";
      if (!adding && !targets.length && !args.allowEmpty && !args.operation.endsWith(".list"))
        throw new SelectionError("missing-selection");
      if (!adding && targets.length > 1 && !args.all && !args.operation.endsWith(".list"))
        throw new SelectionError(
          "ambiguous-selection",
          targets.map((record) => record.location)
        );
      if (args.operation.endsWith(".list") || args.operation.endsWith(".get")) {
        const records = (
          await (editingTheme
            ? Promise.resolve(themeRecords)
            : editingBackground
              ? Promise.all(
                  (scope === "shared"
                    ? (["slides", "layouts", "masters"] as const)
                    : [scope as "slides" | "layouts" | "masters"]
                  ).map((scope) => readBackgrounds(bytes, { scope }, context))
                ).then((records) => records.flat())
              : editingLayout
                ? readLayouts(bytes, context)
                : readMasters(bytes, context))
        ).filter(
          (record) =>
            targets.some((target) => target.part === record.part) &&
            !(args.operation === "backgrounds.get" && "kind" in record && record.kind === "inherit")
        );
        result = success(operation, { records, fingerprint: index.fingerprint }, targets);
        human = records
          .map(
            (record) =>
              `${JSON.stringify("name" in record ? record.name : record.kind)} ${record.part} slides=${record.affectedSlides.join(",")}\n`
          )
          .join("");
      } else {
        let changed = bytes;
        const affectedSlides = new Set<number>();
        const parts: string[] = [];
        const edit = args.masterEdit ?? {};
        const textShapeEdit =
          args.operation === "shapes.set" ||
          (["masters.set", "layouts.set"].includes(args.operation) && edit.text !== undefined);
        if (textShapeEdit) {
          targets = index.objects.filter(
            (record) =>
              targets.some((target) => target.part === record.part) &&
              (args.token ? record.id === selectedShape : record.name === selectedShape)
          );
          if (!targets.length && !args.allowEmpty) throw new SelectionError("missing-selection");
          if (targets.length > 1 && !args.all)
            throw new SelectionError(
              "ambiguous-selection",
              targets.map((record) => record.location)
            );
        }
        const image =
          editingBackground && args.file
            ? await request.readInput(args.file, context.limits.maxBytes)
            : undefined;
        for (const target of adding ? [undefined] : targets) {
          const mutation = addingMaster
            ? await addMaster(
                changed,
                {
                  scope: "masters",
                  name: edit.name!,
                  ...(edit.text === undefined ? {} : { text: edit.text }),
                  ...(edit.theme === undefined ? {} : { theme: edit.theme })
                },
                context
              )
            : addingLayout
              ? await addLayout(
                  changed,
                  {
                    scope: "layouts",
                    name: edit.name!,
                    master: edit.master!,
                    ...edit,
                    ...args.layoutEdit
                  },
                  context
                )
              : applyingLayout
                ? await applyLayout(
                    changed,
                    {
                      selection: {
                        kind: "slide",
                        position: { coordinateSystem: "one-based", value: target!.position }
                      },
                      layout: args.layoutEdit!.layout!,
                      placeholderPolicy: args.layoutEdit!.placeholderPolicy!
                    },
                    context
                  )
                : editingTheme
                  ? await mutateTheme(
                      changed,
                      { ...args.themeEdit, scope: "shared", theme: target!.part },
                      context
                    )
                  : editingBackground
                    ? await mutateBackground(
                        changed,
                        {
                          ...args.backgroundEdit,
                          scope: target!.scope as "slides" | "layouts" | "masters",
                          part: target!.part,
                          kind: args.backgroundEdit!.kind!,
                          ...(image === undefined ? {} : { image })
                        },
                        context
                      )
                    : removingLayout
                      ? await removeLayout(
                          changed,
                          { scope: "layouts", layout: target!.part },
                          context
                        )
                      : editingLayout
                        ? await mutateLayout(
                            changed,
                            {
                              scope: "layouts",
                              layout: target!.part,
                              ...edit,
                              ...args.layoutEdit,
                              ...(textShapeEdit ? { shapeId: target!.id } : {})
                            },
                            context
                          )
                        : args.operation === "shapes.set"
                          ? await mutateMasterShape(
                              changed,
                              {
                                scope: "masters",
                                master: target!.part,
                                shapeId: target!.id,
                                ...edit
                              },
                              context
                            )
                          : await mutateMaster(
                              changed,
                              {
                                scope: "masters",
                                master: target!.part,
                                ...(args.operation === "masters.set"
                                  ? {
                                      ...(edit.name === undefined ? {} : { name: edit.name }),
                                      ...(edit.text === undefined
                                        ? {}
                                        : {
                                            text: edit.text,
                                            shapeId: target!.id
                                          })
                                    }
                                  : {}),
                                ...(args.operation === "shapes.add"
                                  ? {
                                      shapes: [
                                        {
                                          ...(edit.name === undefined ? {} : { name: edit.name }),
                                          text: edit.text ?? "",
                                          x: edit.x!,
                                          y: edit.y!,
                                          width: edit.width!,
                                          height: edit.height!
                                        }
                                      ]
                                    }
                                  : {}),
                                ...(args.operation === "backgrounds.set"
                                  ? {
                                      background:
                                        edit.kind === "inherit" ? null : { color: edit.color! }
                                    }
                                  : {})
                              },
                              context
                            );
          changed = mutation.bytes;
          if (!parts.includes(applyingLayout ? target!.part : mutation.part))
            parts.push(applyingLayout ? target!.part : mutation.part);
          for (const position of mutation.affectedSlides) affectedSlides.add(position);
        }
        const after = await readSelectionIndex(changed, context);
        const changedRecords: SelectionRecord[] = removingLayout ? [...targets] : [];
        if (args.operation === "shapes.add")
          changedRecords.push(
            ...after.objects.filter(
              (record) =>
                parts.includes(record.part) &&
                !index.objects.some(
                  (before) => before.part === record.part && before.id === record.id
                )
            )
          );
        else if (textShapeEdit) {
          const beforeShapes = index.objects.filter(
            (record) =>
              parts.includes(record.part) &&
              (args.token ? record.id === selectedShape : record.name === selectedShape)
          );
          changedRecords.push(
            ...after.objects.filter((record) =>
              beforeShapes.some((before) => before.part === record.part && before.id === record.id)
            )
          );
        }
        if (
          (!textShapeEdit && args.operation !== "shapes.add") ||
          (["masters.set", "layouts.set"].includes(args.operation) && edit.name !== undefined)
        )
          changedRecords.push(
            ...(applyingLayout ? after.slides : after.parts).filter((record) =>
              parts.includes(record.part)
            )
          );
        const dryRun = args.dryRun ?? false;
        const destination = args.inPlace ? args.input! : args.output;
        result = {
          ...success(
            operation,
            {
              part: parts.length === 1 ? parts[0]! : null,
              affectedSlides: [...affectedSlides].sort((a, b) => a - b),
              effects: (after.fingerprint === index.fingerprint ? [] : changedRecords).map(
                (record) => ({
                  location: record.location,
                  action:
                    adding || args.operation === "shapes.add"
                      ? "add"
                      : removingLayout
                        ? "remove"
                        : applyingLayout
                          ? "apply"
                          : "set",
                  feature: editingTheme
                    ? "F13"
                    : editingLayout
                      ? "F12"
                      : args.operation === "backgrounds.set"
                        ? "F14"
                        : args.operation.startsWith("shapes.")
                          ? "F22"
                          : "F11"
                })
              ),
              outputs: dryRun
                ? []
                : [{ path: destination!, sha256: after.fingerprint, bytes: changed.length }],
              fingerprint: dryRun ? null : after.fingerprint
            },
            changedRecords
          ),
          affected: after.fingerprint === index.fingerprint ? 0 : changedRecords.length
        };
        human = `${dryRun ? "Validated" : "Updated"} ${changedRecords.length} shared object(s); affected slides: ${[...affectedSlides].sort((a, b) => a - b).join(", ") || "none"}\n`;
        if (destination === "-" && !dryRun) binary = changed;
        else if (destination && destination !== "-") {
          if (!request.publishOutput)
            throw Object.assign(new Error("Output publication capability is unavailable."), {
              code: "publication-unsupported"
            });
          publication = {
            inputPath: args.input!,
            ...(editingBackground && args.file ? { protectedInputPaths: [args.file] } : {}),
            outputPath: destination,
            bytes: changed,
            originalBytes: bytes,
            inPlace: args.inPlace ?? false,
            force: args.force ?? false,
            dryRun
          };
        }
      }
    } else if (Object.hasOwn(settingsSchemas, args.operation)) {
      const context = { ...options.context, signal: request.signal };
      const bytes = await request.readInput(
        args.input!,
        Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
      );
      const index = await readSelectionIndex(bytes, context);
      const records = index.parts.filter((record) => record.scope === "presentation");
      if (args.operation !== "settings.set") {
        const settings = await readPresentationSettings(bytes, context);
        result = success(
          operation,
          {
            fingerprint: index.fingerprint,
            ...(args.operation === "settings.list" ? { records: [settings] } : { settings })
          },
          records
        );
      } else {
        const changed = await mutatePresentationSettings(bytes, args.settings!, context);
        const after = await readSelectionIndex(changed, context);
        const targets = after.parts.filter((record) => record.scope === "presentation");
        const affected = after.fingerprint === index.fingerprint ? 0 : 1;
        const dryRun = args.dryRun ?? false;
        const destination = args.inPlace ? args.input! : args.output;
        result = {
          ...success(
            operation,
            {
              effects: affected
                ? targets.map((record) => ({
                    location: record.location,
                    action: "update",
                    feature: "F10"
                  }))
                : [],
              outputs: dryRun
                ? []
                : [{ path: destination!, sha256: after.fingerprint, bytes: changed.length }],
              fingerprint: dryRun ? null : after.fingerprint
            },
            targets
          ),
          affected
        };
        human = `${dryRun ? "Validated" : "Updated"} presentation settings\n`;
        if (destination === "-" && !dryRun) binary = changed;
        else if (destination && destination !== "-") {
          if (!request.publishOutput)
            throw Object.assign(new Error("Output publication capability is unavailable."), {
              code: "publication-unsupported"
            });
          publication = {
            inputPath: args.input!,
            outputPath: destination,
            bytes: changed,
            originalBytes: bytes,
            inPlace: args.inPlace ?? false,
            force: args.force ?? false,
            dryRun
          };
        }
      }
    } else if (Object.hasOwn(membershipSchemas, args.operation)) {
      const [kind, action] = args.operation.split(".") as [
        "sections" | "shows",
        "list" | "get" | "add" | "set" | "remove"
      ];
      const context = { ...options.context, signal: request.signal };
      const bytes = await request.readInput(
        args.input!,
        Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
      );
      const index = await readSelectionIndex(bytes, context);
      const owner = index.parts.find((part) => part.scope === "presentation")!.part;
      const before = await readMemberships(bytes, kind, context);
      const located = (record: MembershipRecord, fingerprint: string) => {
        const location = {
          fingerprint,
          scope: "presentation" as const,
          owner,
          objectId: `${kind}:${record.id}`,
          coordinateSystem: "identity" as const
        };
        return { ...record, location, token: JSON.stringify(location) };
      };
      let targets =
        args.slide === undefined
          ? [...before]
          : before.filter((record) => record.slides.includes(args.slide!));
      if (args.token) {
        const location = decodeSelectionToken(args.token);
        if (location.fingerprint !== index.fingerprint) throw new SelectionError("stale-selection");
        if (
          location.scope !== "presentation" ||
          location.owner !== owner ||
          !location.objectId.startsWith(`${kind}:`)
        )
          throw new SelectionError("invalid-selection");
        targets = before.filter((record) => `${kind}:${record.id}` === location.objectId);
      }
      if (action !== "add" && action !== "list") {
        if (!targets.length && !(args.allowEmpty && action !== "get"))
          throw new SelectionError("missing-selection");
        if (targets.length > 1 && !args.all) throw new SelectionError("ambiguous-selection");
      }
      if (action === "list" || action === "get") {
        const records = targets.map((record) => located(record, index.fingerprint));
        result = {
          ...success(operation, { fingerprint: index.fingerprint, records }),
          locations: records.map((record) => record.location)
        };
        human =
          records
            .map(
              (record) =>
                `${record.position} ${JSON.stringify(record.name)} [${record.slides.join(", ")}]`
            )
            .join("\n") + "\n";
      } else {
        const changed = await mutateMemberships(
          bytes,
          kind,
          {
            action,
            ...args.membership,
            ...(action === "add"
              ? {}
              : { selection: { ids: targets.map((target) => target.id), all: args.all ?? false } }),
            allowEmpty: args.allowEmpty ?? false
          },
          context
        );
        const after = await readMemberships(changed, kind, context);
        const afterIndex = await readSelectionIndex(changed, context);
        const affected =
          action === "add"
            ? after.filter((record) => !before.some((previous) => previous.id === record.id))
            : action === "remove"
              ? targets
              : targets.map((target) => after.find((record) => record.id === target.id)!);
        const records = affected.map((record) =>
          located(record, action === "remove" ? index.fingerprint : afterIndex.fingerprint)
        );
        const dryRun = args.dryRun ?? false;
        const destination = args.inPlace ? args.input! : args.output;
        result = {
          ...success(operation, {
            effects:
              afterIndex.fingerprint === index.fingerprint
                ? []
                : records.map((record) => ({
                    location: record.location,
                    action: action === "set" ? "update" : action,
                    feature: "F09"
                  })),
            outputs: dryRun
              ? []
              : [{ path: destination!, sha256: afterIndex.fingerprint, bytes: changed.length }],
            fingerprint: dryRun ? null : afterIndex.fingerprint
          }),
          affected: records.length,
          locations: records.map((record) => record.location)
        };
        human = `${dryRun ? "Validated" : "Updated"} ${records.length} ${records.length === 1 ? kind.slice(0, -1) : kind}\n`;
        if (destination === "-" && !dryRun) binary = changed;
        else if (destination && destination !== "-") {
          if (!request.publishOutput)
            throw Object.assign(new Error("Output publication capability is unavailable."), {
              code: "publication-unsupported"
            });
          publication = {
            inputPath: args.input!,
            outputPath: destination,
            bytes: changed,
            originalBytes: bytes,
            inPlace: args.inPlace ?? false,
            force: args.force ?? false,
            dryRun
          };
        }
      }
    } else if (args.operation === "slides.merge" || args.operation === "slides.split") {
      const context = { ...options.context, signal: request.signal };
      const budget = new SlideTransferBudget(context);
      let remaining = context.limits.maxBytes;
      const inputs: Uint8Array[] = [];
      for (const path of [args.input!, ...(args.sources ?? [])]) {
        if (remaining < 1)
          throw new OfficeError("resource-limit", "Combined input limit exceeded.", "admit");
        const bytes = await request.readInput(
          path,
          Math.min(remaining, context.archiveLimits.maxArchiveBytes)
        );
        if (bytes.length > remaining || bytes.length > context.archiveLimits.maxArchiveBytes)
          throw new OfficeError("resource-limit", "Combined input limit exceeded.", "admit");
        remaining -= bytes.length;
        inputs.push(await budget.read(bytes));
      }
      const before = await transferLocations(inputs[0]!, budget);
      const dryRun = args.dryRun ?? false;
      if (args.operation === "slides.merge") {
        const changed = await mergeSelectedDecks(
          inputs[0]!,
          inputs.slice(1),
          {
            ...args.importing,
            themePolicy: args.importing!.themePolicy!
          },
          context,
          budget
        );
        const after = await transferLocations(changed, budget);
        const targets = after.locations.slice(before.locations.length);
        const destination = args.inPlace ? args.input! : args.output;
        result = {
          ...success(operation, {
            effects: targets.map((location) => ({
              location,
              action: "add",
              feature: "F08"
            })),
            outputs: dryRun
              ? []
              : [{ path: destination!, sha256: after.fingerprint, bytes: changed.length }],
            fingerprint: dryRun ? null : after.fingerprint
          }),
          affected: targets.length,
          locations: targets
        };
        human = `${dryRun ? "Validated" : "Merged"} ${targets.length} slide(s)\n`;
        if (destination === "-" && !dryRun) binary = changed;
        else if (destination && destination !== "-") {
          if (!request.publishOutput)
            throw Object.assign(new Error("Publication unavailable."), {
              code: "publication-unsupported"
            });
          publication = {
            inputPath: args.input!,
            protectedInputPaths: args.sources!,
            outputPath: destination,
            bytes: changed,
            originalBytes: inputs[0]!,
            inPlace: args.inPlace ?? false,
            force: args.force ?? false,
            dryRun
          };
        }
      } else {
        const decks = await splitSelectedDecks(
          inputs[0]!,
          { slides: args.splitSlides! },
          context,
          budget
        );
        splitManifest = decks.map((deck) => ({
          path: `${args.outputDir ?? ""}${args.outputDir?.endsWith("/") || !args.outputDir ? "" : "/"}${deck.name}`,
          sha256: Array.from(sha256(deck.bytes), (byte) => byte.toString(16).padStart(2, "0")).join(
            ""
          ),
          bytes: deck.bytes.length,
          sourceSlide: deck.sourceSlide,
          sourceLocation: before.locations[deck.sourceSlide - 1]!
        }));
        allowPartialOutput = args.allowPartialOutput ?? false;
        if (!dryRun && !request.publishOutputs && (!allowPartialOutput || !request.publishOutput))
          throw Object.assign(
            new Error("Split requires atomic publication or explicit partial output."),
            { code: "publication-unsupported" }
          );
        if (args.outputDir)
          publications = decks.map((deck, index) => ({
            inputPath: args.input!,
            outputPath: splitManifest[index]!.path,
            bytes: deck.bytes,
            originalBytes: inputs[0]!,
            inPlace: false,
            force: args.force ?? false,
            dryRun
          }));
        result = {
          ...success(operation, {
            outputs: dryRun
              ? []
              : splitManifest.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
            sources: splitManifest.map(({ sourceSlide, sourceLocation }) => ({
              sourceSlide,
              sourceLocation
            }))
          }),
          affected: decks.length,
          locations: splitManifest.map((item) => item.sourceLocation)
        };
        human = `${dryRun ? "Validated" : "Split"} ${decks.length} slide(s)\n${JSON.stringify(result.data, null, 2)}\n`;
      }
    } else if (args.operation === "create") {
      if (args.template)
        throw new OfficeError(
          "unsupported-profile",
          "Template-based creation is unavailable.",
          "validate-intent"
        );
      const context = { ...options.context, signal: request.signal };
      const bytes = await createPresentation(args.creation ?? {}, context);
      const index = await readSelectionIndex(bytes, context);
      const dryRun = args.dryRun ?? false;
      const location = {
        fingerprint: index.fingerprint,
        scope: "presentation" as const,
        owner: "/ppt/presentation.xml",
        objectId: "/ppt/presentation.xml",
        coordinateSystem: "identity" as const
      };
      result = {
        ...success(operation, {
          effects: [{ location, action: "add", feature: "F06" }],
          outputs: dryRun
            ? []
            : [{ path: args.output!, sha256: index.fingerprint, bytes: bytes.length }],
          fingerprint: dryRun ? null : index.fingerprint
        }),
        affected: 1,
        locations: [location]
      };
      human = `${dryRun ? "Validated" : "Created"} presentation (${index.slides.length} slides)\n`;
      if (args.output === "-" && !dryRun) binary = bytes;
      else if (args.output && args.output !== "-") {
        if (!request.publishOutput)
          throw Object.assign(new Error("Output publication capability is unavailable."), {
            code: "publication-unsupported"
          });
        publication = {
          outputPath: args.output,
          bytes,
          originalBytes: new Uint8Array(),
          inPlace: false,
          force: args.force ?? false,
          dryRun
        };
      }
    } else {
      if (args.token) decodeSelectionToken(args.token);
      let bytes: Uint8Array;
      try {
        bytes = await request.readInput(
          args.input!,
          Math.min(options.context.limits.maxBytes, options.context.archiveLimits.maxArchiveBytes)
        );
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "resource-limit"
        )
          throw new OfficeError("resource-limit", "Input limit exceeded.", "admit");
        throw error;
      }
      const index = await readSelectionIndex(bytes, { ...options.context, signal: request.signal });
      const metadata =
        args.operation === "xml.get" &&
        args.scope === "shared" &&
        args.part &&
        (args.part === "/[Content_Types].xml" ||
          args.part === packageUri("/").relsUri ||
          index.parts.some((record) => packageUri(record.part).relsUri === args.part))
          ? args.part
          : undefined;
      const mutationSelection =
        args.selection ??
        (args.token
          ? { token: args.token }
          : {
              kind: "slide" as const,
              ...(args.slide === undefined
                ? {}
                : { position: { coordinateSystem: "one-based" as const, value: args.slide } }),
              ...(args.all ? { all: true } : {})
            });
      const records =
        metadata ||
        args.operation === "slides.import" ||
        args.operation === "slides.move" ||
        args.operation === "slides.set" ||
        args.operation === "slides.remove" ||
        args.operation === "slides.duplicate"
          ? []
          : selected(index, args);
      if (args.operation === "slides.add") {
        const context = { ...options.context, signal: request.signal };
        const changed = await addSlide(bytes, args.addition as AddSlideOptions, context);
        const after = await readSelectionIndex(changed, context);
        const slide = after.slides[(args.addition?.position ?? after.slides.length) - 1]!;
        const dryRun = args.dryRun ?? false;
        const destination = args.inPlace ? args.input! : args.output;
        result = {
          ...success(
            operation,
            {
              effects: [{ location: slide.location, action: "add", feature: "F07" }],
              outputs: dryRun
                ? []
                : [{ path: destination!, sha256: after.fingerprint, bytes: changed.length }],
              fingerprint: dryRun ? null : after.fingerprint
            },
            [slide]
          ),
          affected: 1
        };
        human = `${dryRun ? "Validated" : "Added"} slide ${slide.position} ${JSON.stringify(slide.name)}\n`;
        if (destination === "-" && !dryRun) binary = changed;
        else if (destination && destination !== "-") {
          if (!request.publishOutput)
            throw Object.assign(new Error("Output publication capability is unavailable."), {
              code: "publication-unsupported"
            });
          publication = {
            inputPath: args.input!,
            outputPath: destination,
            bytes: changed,
            originalBytes: bytes,
            inPlace: args.inPlace ?? false,
            force: args.force ?? false,
            dryRun
          };
        }
      } else if (
        args.operation === "slides.import" ||
        args.operation === "slides.move" ||
        args.operation === "slides.set" ||
        args.operation === "slides.remove" ||
        args.operation === "slides.duplicate"
      ) {
        const context = { ...options.context, signal: request.signal };
        const changed =
          args.operation === "slides.import"
            ? await importSlides(
                bytes,
                await request.readInput(
                  args.source!,
                  Math.min(
                    options.context.limits.maxBytes,
                    options.context.archiveLimits.maxArchiveBytes
                  )
                ),
                args.importing as ImportSlidesOptions,
                context
              )
            : args.operation === "slides.duplicate"
              ? await duplicateSlides(
                  bytes,
                  {
                    selection: mutationSelection,
                    position: args.mutation!.position!,
                    allowEmpty: args.allowEmpty ?? false
                  },
                  context
                )
              : args.operation === "slides.remove"
                ? await removeSlides(
                    bytes,
                    {
                      selection: mutationSelection,
                      allowEmpty: args.allowEmpty ?? false,
                      ...(args.referencePolicy ? { referencePolicy: args.referencePolicy } : {})
                    },
                    context
                  )
                : await mutateSlides(
                    bytes,
                    {
                      ...args.mutation,
                      selection: mutationSelection,
                      allowEmpty: args.allowEmpty ?? false
                    },
                    context
                  );
        const after = await readSelectionIndex(changed, context);
        const beforeTargets = (
          args.operation === "slides.import"
            ? []
            : Array.isArray(mutationSelection)
              ? mutationSelection
              : [mutationSelection]
        ).flatMap((query) => {
          try {
            return index.select(query);
          } catch (error) {
            if (
              args.allowEmpty &&
              error instanceof SelectionError &&
              error.code === "missing-selection"
            )
              return [];
            throw error;
          }
        });
        const targets =
          args.operation === "slides.import" || args.operation === "slides.duplicate"
            ? after.slides.filter(
                (slide) => !index.slides.some((original) => original.id === slide.id)
              )
            : args.operation === "slides.remove"
              ? beforeTargets
              : beforeTargets.map(
                  (record) => after.slides.find((slide) => slide.id === record.id)!
                );
        const dryRun = args.dryRun ?? false;
        const destination = args.inPlace ? args.input! : args.output;
        result = {
          ...success(
            operation,
            {
              effects: (after.fingerprint === index.fingerprint ? [] : targets).map((slide) => ({
                location: slide.location,
                action:
                  args.operation === "slides.import" || args.operation === "slides.duplicate"
                    ? "add"
                    : args.operation === "slides.remove"
                      ? "remove"
                      : "update",
                feature: args.operation === "slides.import" ? "F08" : "F07"
              })),
              outputs: dryRun
                ? []
                : [{ path: destination!, sha256: after.fingerprint, bytes: changed.length }],
              fingerprint: dryRun ? null : after.fingerprint
            },
            targets
          ),
          affected: targets.length
        };
        human = `${dryRun ? "Validated" : args.operation === "slides.import" ? "Imported" : args.operation === "slides.duplicate" ? "Duplicated" : args.operation === "slides.remove" ? "Removed" : "Updated"} ${targets.length} slide(s)\n`;
        if (destination === "-" && !dryRun) binary = changed;
        else if (destination && destination !== "-") {
          if (!request.publishOutput)
            throw Object.assign(new Error("Output publication capability is unavailable."), {
              code: "publication-unsupported"
            });
          publication = {
            inputPath: args.input!,
            ...(args.operation === "slides.import" ? { protectedInputPaths: [args.source!] } : {}),
            outputPath: destination,
            bytes: changed,
            originalBytes: bytes,
            inPlace: args.inPlace ?? false,
            force: args.force ?? false,
            dryRun
          };
        }
      } else if (args.operation === "xml.get" || args.operation === "xml.set") {
        if (!metadata && (records.length !== 1 || records[0]!.kind === "object"))
          throw new SelectionError("invalid-selection");
        const part = metadata ?? records[0]!.part;
        const validationLimits = options.context.validationLimits;
        if (!validationLimits)
          throw new OfficeError(
            "invalid-value",
            "XML operations require explicit validation limits.",
            "usage"
          );
        const context = { ...options.context, validationLimits, signal: request.signal };
        if (args.operation === "xml.get") {
          const xml = await getXmlPart(bytes, part, context, { pretty: args.pretty ?? false });
          result = success(
            operation,
            { part: xml.part, format: xml.format, xml: xml.xml },
            records
          );
          if (metadata)
            result = {
              ...result,
              locations: [
                {
                  fingerprint: index.fingerprint,
                  scope: "shared",
                  owner: metadata,
                  objectId: metadata,
                  coordinateSystem: "identity"
                }
              ]
            };
          if (args.pretty) human = `Pretty XML (not original bytes)\n${xml.xml}\n`;
          else if (!args.json) binary = xml.bytes;
        } else {
          const replacement = await request.readInput(
            args.file!,
            Math.min(validationLimits.maxBytes, context.archiveLimits.maxEntryBytes)
          );
          const changed = await replaceXmlPart(bytes, part, replacement, context);
          result = {
            ...success(operation, { part, dryRun: args.dryRun ?? false }, records),
            affected: 1
          };
          human = `${args.dryRun ? "Validated" : "Replaced"} XML part ${part}\n`;
          const destination = args.inPlace ? args.input! : args.output;
          if (destination === "-" && !args.dryRun) binary = changed;
          else if (destination && destination !== "-") {
            if (!request.publishOutput)
              throw Object.assign(new Error("Output publication capability is unavailable."), {
                code: "publication-unsupported"
              });
            publication = {
              inputPath: args.input!,
              outputPath: destination,
              bytes: changed,
              originalBytes: bytes,
              inPlace: args.inPlace ?? false,
              force: args.force ?? false,
              dryRun: args.dryRun ?? false
            };
          }
        }
      } else {
        result = success(
          operation,
          { fingerprint: index.fingerprint, records, inventory: index.inventory },
          records
        );
        human = records
          .map(
            (record) =>
              `${record.kind} ${record.position} ${JSON.stringify(record.name)} id=${JSON.stringify(record.id)} owner=${JSON.stringify(record.part)}\n`
          )
          .join("");
      }
    }
  } catch (error) {
    if (request.signal.aborted)
      return { exitCode: 130, stdout: new Uint8Array(), stderr: new Uint8Array() };
    const office = error instanceof OfficeError ? error : undefined;
    const capabilityCode =
      error && typeof error === "object" && "code" in error ? error.code : undefined;
    const limit = office?.code === "resource-limit" || capabilityCode === "resource-limit";
    const unsupported = capabilityCode === "publication-unsupported";
    exitCode = limit
      ? 4
      : unsupported
        ? 1
        : office?.code === "cancelled"
          ? 130
          : office?.code === "unsupported-profile"
            ? 1
            : office?.phase === "usage" || office?.code === "invalid-selection"
              ? 2
              : office?.code === "io-failure" || !office
                ? 3
                : 1;
    const diagnostic: Diagnostic = {
      code: limit
        ? "resource-limit"
        : unsupported
          ? "publication-unsupported"
          : (office?.code ?? "io-failure"),
      message: limit
        ? "Input or argument limit exceeded."
        : unsupported
          ? "Output publication capability is unavailable."
          : (office?.message ?? "Input could not be read."),
      context: {
        phase: office?.phase ?? (unsupported ? "publish" : "admit"),
        ...(error instanceof SelectionError ? { candidates: error.candidates } : {})
      }
    };
    result = {
      version: 1,
      operation: output.operation,
      ok: false,
      data: null,
      warnings: [],
      errors: [diagnostic],
      affected: 0,
      locations: []
    };
    human = `pptx: ${diagnostic.code}: ${diagnostic.message}\n`;
  }
  const { json, operation } = output;
  const encoded =
    binary ??
    new TextEncoder().encode(
      json ? `${JSON.stringify(result)}\n` : (human ?? `${JSON.stringify(result.data, null, 2)}\n`)
    );
  if (encoded.length > options.maxOutputBytes) return outputLimitFailure(operation, json);
  if (publications && result.ok) {
    let published = 0;
    const partialFailure = (code: string, phase: string) => ({
      ...result,
      ok: false,
      affected: allowPartialOutput ? published : 0,
      locations: allowPartialOutput
        ? splitManifest.slice(0, published).map((item) => item.sourceLocation)
        : [],
      data:
        allowPartialOutput && published > 0
          ? {
              outputs: splitManifest
                .slice(0, published)
                .map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
              sources: splitManifest
                .slice(0, published)
                .map(({ sourceSlide, sourceLocation }) => ({ sourceSlide, sourceLocation }))
            }
          : null,
      errors: [{ code, message: "Output could not be published.", context: { phase } }]
    });
    const reserve =
      new TextEncoder().encode(
        JSON.stringify({
          ...partialFailure("publication-unsupported", "publish"),
          locations: splitManifest.map((item) => item.sourceLocation),
          data: {
            outputs: splitManifest.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
            sources: splitManifest.map(({ sourceSlide, sourceLocation }) => ({
              sourceSlide,
              sourceLocation
            }))
          }
        })
      ).length + 1;
    if (reserve > options.maxOutputBytes) return outputLimitFailure(operation, json);
    try {
      for (const item of publications) {
        request.signal.throwIfAborted();
        if (request.preflightOutput) await request.preflightOutput(item);
        else if (request.publishOutput) await request.publishOutput({ ...item, dryRun: true });
      }
      if (!publications[0]?.dryRun) {
        if (request.publishOutputs) await request.publishOutputs(publications);
        else
          for (const item of publications) {
            request.signal.throwIfAborted();
            await request.publishOutput!(item);
            published++;
          }
      }
    } catch (error) {
      const rawCode =
        error && typeof error === "object" && "code" in error ? error.code : undefined;
      const code = request.signal.aborted
        ? "cancelled"
        : typeof rawCode === "string" &&
            ["resource-limit", "stale-input", "publication-unsupported"].includes(rawCode)
          ? rawCode
          : "io-failure";
      const failure = partialFailure(code, "publish");
      const message = new TextEncoder().encode(
        json
          ? `${JSON.stringify(failure)}\n`
          : `pptx: ${code}: Output could not be published.\n${JSON.stringify(failure.data)}\n`
      );
      return {
        exitCode:
          code === "cancelled"
            ? 130
            : code === "resource-limit"
              ? 4
              : code === "publication-unsupported" || code === "stale-input"
                ? 1
                : 3,
        stdout: json ? message : new Uint8Array(),
        stderr: json ? new Uint8Array() : message
      };
    }
  }
  if (publication && result.ok) {
    try {
      request.signal.throwIfAborted();
      await request.publishOutput!(publication);
    } catch (error) {
      if (request.signal.aborted)
        return { exitCode: 130, stdout: new Uint8Array(), stderr: new Uint8Array() };
      const office = error instanceof OfficeError ? error : undefined;
      const rawCode =
        error && typeof error === "object" && "code" in error ? error.code : undefined;
      const code =
        typeof rawCode === "string" &&
        [
          "resource-limit",
          "stale-selection",
          "stale-input",
          "publication-unsupported",
          "io-failure"
        ].includes(rawCode)
          ? rawCode
          : (office?.code ?? "io-failure");
      const failure = {
        ...result,
        ok: false,
        data: null,
        affected: 0,
        locations: [],
        errors: [
          {
            code,
            message:
              code === "resource-limit"
                ? "Output limit exceeded."
                : code === "publication-unsupported"
                  ? "Atomic output publication is unavailable."
                  : code === "stale-input" || code === "stale-selection"
                    ? "Input changed before publication."
                    : "Output could not be published.",
            context: { phase: office?.phase ?? "publish" }
          }
        ]
      };
      const message = new TextEncoder().encode(
        json ? `${JSON.stringify(failure)}\n` : `pptx: ${code}: ${failure.errors[0]!.message}\n`
      );
      if (message.length > options.maxOutputBytes) return outputLimitFailure(operation, json);
      return {
        exitCode:
          code === "resource-limit"
            ? 4
            : office?.phase === "usage"
              ? 2
              : code === "stale-selection" ||
                  code === "stale-input" ||
                  code === "publication-unsupported"
                ? 1
                : 3,
        stdout: json ? message : new Uint8Array(),
        stderr: json ? new Uint8Array() : message
      };
    }
  }
  return {
    exitCode,
    stdout: json || result.ok ? encoded : new Uint8Array(),
    stderr: json || result.ok ? new Uint8Array() : encoded
  };
}

export function createPptxCommandEngine(options: PptxCommandEngineOptions): PptxCommandEngine {
  if (
    !options?.context ||
    ![options.maxArgumentBytes, options.maxOutputBytes, options.context.limits?.maxBytes].every(
      (value) => Number.isSafeInteger(value) && value > 0
    ) ||
    options.maxOutputBytes < 512
  )
    throw new TypeError(
      "Explicit positive pptx limits and at least 512 output bytes are required."
    );
  const owned = {
    ...options,
    context: {
      ...options.context,
      limits: { ...options.context.limits },
      archiveLimits: { ...options.context.archiveLimits },
      xmlLimits: { ...options.context.xmlLimits },
      relationshipLimits: { ...options.context.relationshipLimits },
      ...(options.context.validationLimits
        ? { validationLimits: { ...options.context.validationLimits } }
        : {})
    }
  };
  return Object.freeze({ execute: (request: PptxCommandRequest) => execute(request, owned) });
}
