import { OfficeError } from "./errors.js";
import type { BinaryInput } from "./contracts.js";
import {
  attr,
  child,
  fields,
  invalid,
  loadShared,
  required,
  unique,
  type SharedEditResult
} from "./masters.js";
import type { SelectionContext } from "./selectors.js";
export const themeColorSlots = [
  "dk1",
  "lt1",
  "dk2",
  "lt2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink"
] as const;
export const themeFontSlots = [
  "majorLatin",
  "minorLatin",
  "majorEastAsia",
  "minorEastAsia",
  "majorComplex",
  "minorComplex"
] as const;
export interface ThemeRecord {
  readonly part: string;
  readonly name: string;
  readonly override: boolean;
  readonly colors: Readonly<Record<string, string | null>>;
  readonly fonts: Readonly<Record<string, string | null>>;
  readonly affectedSlides: readonly number[];
}
export interface MutateThemeOptions {
  readonly scope: "shared";
  readonly theme: string;
  readonly name?: string;
  readonly colorSlot?: (typeof themeColorSlots)[number];
  readonly color?: string;
  readonly fontSlot?: (typeof themeFontSlots)[number];
  readonly font?: string;
}
export function validateColor(color: unknown): asserts color is string {
  if (
    typeof color !== "string" ||
    color.length !== 6 ||
    [...color].some((c) => !"0123456789abcdefABCDEF".includes(c))
  )
    invalid("Color must contain six hexadecimal digits.");
}
function themeParts(s: Awaited<ReturnType<typeof loadShared>>) {
  return [
    ...new Set([
      ...s.index.inventory.themes,
      ...s.index.inventory.relationships
        .filter((e) => e.type === `${s.r}/themeOverride` && !e.external)
        .map((e) => e.targetPart!)
    ])
  ];
}
function affected(s: Awaited<ReturnType<typeof loadShared>>, part: string) {
  const owners = s.index.inventory.relationships
    .filter((e) => e.targetPart === part && !e.external)
    .map((e) => e.owner);
  return s.index.inventory.slides
    .filter(
      (slide) =>
        slide.theme === part ||
        owners.some((owner) => [slide.part, slide.layout, slide.master].includes(owner))
    )
    .map((slide) => slide.position);
}
function fontPath(slot: string) {
  return [
    slot.startsWith("major") ? "majorFont" : "minorFont",
    slot.endsWith("Latin") ? "latin" : slot.endsWith("EastAsia") ? "ea" : "cs"
  ] as const;
}
export async function readThemes(
  input: BinaryInput,
  context: SelectionContext
): Promise<readonly ThemeRecord[]> {
  const s = await loadShared(input, context, false);
  return themeParts(s).map((part) => {
    const root = s.doc(part).root,
      override = root.name.localName === "themeOverride",
      container = override ? root : required(root, "themeElements");
    const colors = child(container, "clrScheme"),
      fonts = child(container, "fontScheme");
    return {
      part,
      name: attr(root, "name") ?? "",
      override,
      affectedSlides: affected(s, part),
      colors: Object.fromEntries(
        themeColorSlots.map((slot) => {
          const n = colors && child(colors, slot),
            v = n?.children.find((c) => c.name.namespace === s.a);
          return [
            slot,
            v
              ? ((v.name.localName === "srgbClr"
                  ? attr(v, "val")
                  : v.name.localName === "sysClr"
                    ? attr(v, "lastClr")
                    : null) ?? null)
              : null
          ];
        })
      ),
      fonts: Object.fromEntries(
        themeFontSlots.map((slot) => {
          const [family, script] = fontPath(slot),
            n = fonts && child(fonts, family),
            v = n && child(n, script);
          return [slot, v ? (attr(v, "typeface") ?? null) : null];
        })
      )
    };
  });
}
export async function mutateTheme(
  input: BinaryInput,
  options: MutateThemeOptions,
  context: SelectionContext
): Promise<SharedEditResult> {
  fields(options, ["scope", "theme", "name", "colorSlot", "color", "fontSlot", "font"], ["shared"]);
  if (
    (options.colorSlot === undefined) !== (options.color === undefined) ||
    (options.fontSlot === undefined) !== (options.font === undefined)
  )
    invalid("Color and font edits require both slot and value.");
  if (options.colorSlot !== undefined) {
    if (!themeColorSlots.includes(options.colorSlot)) invalid("Unknown theme color slot.");
    validateColor(options.color);
  }
  if (options.fontSlot !== undefined && !themeFontSlots.includes(options.fontSlot))
    invalid("Unknown theme font slot.");
  if (
    [options.name, options.font].some(
      (v) => v !== undefined && (typeof v !== "string" || v.length > context.xmlLimits.maxBytes)
    )
  )
    invalid("Invalid theme text.");
  if (
    options.name === undefined &&
    options.colorSlot === undefined &&
    options.fontSlot === undefined
  )
    invalid("A theme change is required.");
  const s = await loadShared(input, context),
    part = unique(
      themeParts(s).filter((p) => p === options.theme),
      "Select one theme."
    );
  let xml = s.doc(part);
  if (
    xml.root.name.namespace !== s.a ||
    !["theme", "themeOverride"].includes(xml.root.name.localName)
  )
    throw new OfficeError("unsupported-edit", "Unsupported theme root.", "validate-intent");
  if (xml.root.name.localName === "themeOverride" && options.name !== undefined)
    throw new OfficeError(
      "unsupported-edit",
      "Theme overrides do not have names.",
      "validate-intent"
    );
  const container = () =>
    xml.root.name.localName === "themeOverride" ? xml.root : required(xml.root, "themeElements");
  if (options.name !== undefined)
    xml = xml.merge(xml.root, {
      attributes: [{ namespace: "", localName: "name", value: options.name }]
    });
  if (options.colorSlot !== undefined) {
    const scheme = required(container(), "clrScheme"),
      slot = required(scheme, options.colorSlot),
      colors = slot.children.filter(
        (n) =>
          n.name.namespace === s.a &&
          ["srgbClr", "sysClr", "scrgbClr", "hslClr", "prstClr", "schemeClr"].includes(
            n.name.localName
          )
      );
    const old = unique(colors, "Expected one theme color.");
    if (old.name.localName === "srgbClr")
      xml = xml.merge(old, {
        attributes: [{ namespace: "", localName: "val", value: options.color! }]
      });
    else {
      if (
        old.children.length ||
        old.attributes.some(
          (a) => a.name.namespace !== "" || !["val", "lastClr"].includes(a.name.localName)
        )
      )
        throw new OfficeError(
          "unsupported-edit",
          "Color extensions cannot be discarded by conversion.",
          "validate-intent"
        );
      xml = xml.spliceChildren(slot, slot.children.indexOf(old), 1, [
        `<a:srgbClr xmlns:a="${s.a}" val="${options.color}"/>`
      ]);
    }
  }
  if (options.fontSlot !== undefined) {
    const [family, script] = fontPath(options.fontSlot),
      node = required(required(required(container(), "fontScheme"), family), script);
    xml = xml.merge(node, {
      attributes: [{ namespace: "", localName: "typeface", value: options.font! }]
    });
  }
  s.save(part, xml);
  return s.finish(part, affected(s, part));
}
