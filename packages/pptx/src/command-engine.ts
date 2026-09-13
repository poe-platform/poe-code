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
import type { Diagnostic, OfficeResult, Scope } from "./contracts.js";
import {
  membershipSchemas,
  settingsSchemas,
  createSchema,
  inspectSchema,
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
  operation:
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
    | "inspect"
    | "xml.get"
    | "xml.set"
    | "schema"
    | "capabilities"
    | "help"
    | "version";
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

const scalarOptions = [
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
      if (["create", "inspect", "schema", "capabilities", "help", "version"].includes(command))
        output.operation = command;
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
      ["sections", "shows"].includes(args[0]!) &&
      ["list", "get", "add", "set", "remove"].includes(argument)
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
  const command = ["xml", "slides", "sections", "shows", "settings"].includes(args[0]!)
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
      ...Object.keys(membershipSchemas),
      ...Object.keys(settingsSchemas),
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
    if (argument === "--all") {
      result.all = true;
      continue;
    }
    if (!scalarOptions.includes(argument)) usage("Unsupported option.");
    const value = args[++index];
    if (
      value === undefined ||
      (value.length === 0 && !["--author", "--name", "--title", "--body"].includes(argument))
    )
      usage("Missing option value.");
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
        ...Object.keys(membershipSchemas),
        ...Object.keys(settingsSchemas),
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
      result = success(operation, { usage: help });
      human = help;
    } else if (args.operation === "version") {
      result = success(operation, { version: 1, profile: "selectors" });
      human = "pptx selectors v1\n";
    } else if (args.operation === "schema")
      result = success(operation, {
        version: 1,
        operations: Object.fromEntries(
          Object.entries({
            ...membershipSchemas,
            ...settingsSchemas,
            create: createSchema,
            inspect: inspectSchema,
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
              "ordered slides, owner graph, part hashes, media parts and slide visibility; semantic content remains uninspected"
          },
          slides: {
            level: "edit",
            subset:
              "Insert at a validated position using an explicit layout/master; populate unambiguous type/index placeholders. Move ordered slides while retaining IDs; set names and visibility. Remove slides with explicit known-reference removal policy; reject unresolved opaque references and retain shared resources. Duplicate slide-local shapes and notes with fresh identities; clone mutable dependent resources and reject unsupported references. Layout reassignment and background changes are unavailable."
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
    else if (Object.hasOwn(settingsSchemas, args.operation)) {
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
