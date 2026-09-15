import { packUriBatchActions } from "./pack-uri-batch-operations.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { imageBatchActions } from "./image-batch-operations.js";
import { Length, Emu, Inches, Cm, Mm, Pt, Twips, isLength, enumMembers, enumString, enumValue, enumFromValue, enumFromXml, enumXml } from "./formatting-values.js";
import { DocxUsageError } from "./argument-json.js";
import { BaseStyle, CharacterStyle, ParagraphStyle, TableStyle, Styles, LatentStyles, LatentStyle } from "./styles-model.js";
import { Font, ParagraphFormat, TabStops, TabStop, ColorFormat, RGBColor } from "./formatting-model.js";
import type { DocxEnumValue, DocxLength } from "./operation-types.js";

type Action = (receiver: unknown, args: Readonly<Record<string, unknown>>) => unknown;
export const styleModelBatchActions = new Map<string, Action>(packUriBatchActions);
type ModelClass = abstract new (...args: never[]) => object;
function properties(prefix: string, owner: ModelClass, names: readonly string[], writable: readonly string[] = names): void {
  for (const name of names) {
    styleModelBatchActions.set(`${prefix}.${name}.get`, receiver => {
      if (!(receiver instanceof owner)) throw new DocxUsageError("The receiver does not support this property.");
      return Reflect.get(receiver, name);
    });
    if (writable.includes(name)) styleModelBatchActions.set(`${prefix}.${name}.set`, (receiver, args) => {
      if (!(receiver instanceof owner)) throw new DocxUsageError("The receiver does not support this property.");
      if (!Reflect.set(receiver, name, args.value)) throw new DocxUsageError("The property is not writable.");
    });
  }
}
function method(prefix: string, name: string, owner: ModelClass, action: (receiver: object, args: Readonly<Record<string, unknown>>) => unknown): void {
  styleModelBatchActions.set(`${prefix}.${name}`, (receiver, args) => {
    if (!(receiver instanceof owner)) throw new DocxUsageError("The receiver does not support this method.");
    return action(receiver, args);
  });
}
const styleProperties = ["name", "style_id", "priority", "hidden", "locked", "quick_style", "unhide_when_used"];
for (const [name, owner] of [["BaseStyle", BaseStyle], ["CharacterStyle", CharacterStyle], ["ParagraphStyle", ParagraphStyle], ["_TableStyle", TableStyle], ["_NumberingStyle", BaseStyle]] as const) {
  const prefix = `model.styles.style.${name}`;
  properties(prefix, owner, [...styleProperties, "type", "builtin"], styleProperties);
  method(prefix, "delete.call", owner, receiver => (receiver as BaseStyle).delete());
  if (owner === CharacterStyle || owner === ParagraphStyle || owner === TableStyle) properties(prefix, owner, ["base_style", "font"], ["base_style"]);
  if (owner === ParagraphStyle || owner === TableStyle) properties(prefix, owner, ["paragraph_format", "next_paragraph_style"], ["next_paragraph_style"]);
}
const styles = "model.styles.styles.Styles";
properties(styles, Styles, ["latent_styles"], []);
method(styles, "add_style.call", Styles, (receiver, args) => (receiver as Styles).add_style(args.name as string, args.styleType as DocxEnumValue<"WD_STYLE_TYPE">, args.builtin as boolean | undefined));
method(styles, "default.call", Styles, (receiver, args) => (receiver as Styles).default(args.styleType as DocxEnumValue<"WD_STYLE_TYPE">));
method(styles, "get_by_id.call", Styles, (receiver, args) => (receiver as Styles).get_by_id(args.styleId as string | null, args.styleType as DocxEnumValue<"WD_STYLE_TYPE">));
method(styles, "get_style_id.call", Styles, (receiver, args) => (receiver as Styles).get_style_id(args.styleOrName as BaseStyle | string | null, args.styleType as DocxEnumValue<"WD_STYLE_TYPE">));
method(styles, "__contains__.call", Styles, (receiver, args) => (receiver as Styles).has(args.value as string));
method(styles, "__getitem__.call", Styles, (receiver, args) => (receiver as Styles).at(args.key as string));
method(styles, "__iter__.call", Styles, receiver => [...receiver as Styles]);
method(styles, "__len__.get", Styles, receiver => (receiver as Styles).length);
const latent = "model.styles.latent.LatentStyles";
properties(latent, LatentStyles, ["default_priority", "default_to_hidden", "default_to_locked", "default_to_quick_style", "default_to_unhide_when_used", "load_count"]);
method(latent, "add_latent_style.call", LatentStyles, (receiver, args) => (receiver as LatentStyles).add_latent_style(args.name as string));
method(latent, "__getitem__.call", LatentStyles, (receiver, args) => (receiver as LatentStyles).at(args.key as string));
method(latent, "__iter__.call", LatentStyles, receiver => [...receiver as LatentStyles]);
method(latent, "__len__.get", LatentStyles, receiver => (receiver as LatentStyles).length);
properties("model.styles.latent._LatentStyle", LatentStyle, ["name", "priority", "hidden", "locked", "quick_style", "unhide_when_used"], ["priority", "hidden", "locked", "quick_style", "unhide_when_used"]);
method("model.styles.latent._LatentStyle", "delete.call", LatentStyle, receiver => (receiver as LatentStyle).delete());
properties("model.text.run.Font", Font, ["all_caps", "bold", "complex_script", "cs_bold", "cs_italic", "double_strike", "emboss", "hidden", "imprint", "italic", "math", "no_proof", "outline", "rtl", "shadow", "small_caps", "snap_to_grid", "spec_vanish", "strike", "web_hidden", "name", "size", "underline", "highlight_color", "superscript", "subscript"]);
properties("model.text.parfmt.ParagraphFormat", ParagraphFormat, ["alignment", "first_line_indent", "keep_together", "keep_with_next", "left_indent", "line_spacing", "line_spacing_rule", "page_break_before", "right_indent", "space_after", "space_before", "widow_control", "tab_stops"], ["alignment", "first_line_indent", "keep_together", "keep_with_next", "left_indent", "line_spacing", "line_spacing_rule", "page_break_before", "right_indent", "space_after", "space_before", "widow_control"]);
const tabs = "model.text.tabstops.TabStops";
method(tabs, "add_tab_stop.call", TabStops, (receiver, args) => (receiver as TabStops).add_tab_stop(args.position as DocxLength, args.alignment as DocxEnumValue<"WD_TAB_ALIGNMENT"> | undefined, args.leader as DocxEnumValue<"WD_TAB_LEADER"> | undefined));
method(tabs, "__getitem__.get", TabStops, (receiver, args) => (receiver as TabStops).at(args.index as number));
method(tabs, "__delitem__.call", TabStops, (receiver, args) => (receiver as TabStops).delete(args.index as number));
method(tabs, "__iter__.call", TabStops, receiver => [...receiver as TabStops]);
method(tabs, "__len__.get", TabStops, receiver => (receiver as TabStops).length);
method(tabs, "clear_all.call", TabStops, receiver => (receiver as TabStops).clear_all());
properties("model.text.tabstops.TabStop", TabStop, ["alignment", "leader", "position"]);
properties("model.text.run.Font", Font, ["color"], []);
properties("model.dml.color.ColorFormat", ColorFormat, ["theme_color", "type"], ["theme_color"]);
method("model.dml.color.ColorFormat", "rgb.get", ColorFormat, receiver => (receiver as ColorFormat).rgb);
method("model.dml.color.ColorFormat", "rgb.set", ColorFormat, (receiver, args) => { (receiver as ColorFormat).rgb = args.value === null ? null : args.value instanceof RGBColor ? args.value : RGBColor.from_string(args.value as string); });
styleModelBatchActions.set("model.shared.RGBColor.call", (_receiver, args) => new RGBColor(args.r as number, args.g as number, args.b as number));
styleModelBatchActions.set("model.shared.RGBColor.from_string.call", (_receiver, args) => RGBColor.from_string(args.rgbHexStr as string));
method("model.shared.RGBColor", "__str__.call", RGBColor, receiver => (receiver as RGBColor).toString());
method("model.shared.RGBColor", "__len__.get", RGBColor, receiver => (receiver as RGBColor).length);
method("model.shared.RGBColor", "__iter__.call", RGBColor, receiver => [...receiver as RGBColor]);
method("model.shared.RGBColor", "__getitem__.call", RGBColor, (receiver, args) => (receiver as RGBColor).at(args.index as number));
method("model.shared.RGBColor", "__getitem__.slice", RGBColor, (receiver, args) => (receiver as RGBColor).slice(args.start as number | undefined, args.end as number | undefined));
method("model.shared.RGBColor", "count.call", RGBColor, (receiver, args) => (receiver as RGBColor).count(args.value as number));
method("model.shared.RGBColor", "index.call", RGBColor, (receiver, args) => (receiver as RGBColor).index(args.value as number, args.start as number | undefined, args.stop as number | undefined));
method("model.shared.RGBColor", "__contains__.call", RGBColor, (receiver, args) => (receiver as RGBColor).includes(args.channel as number));
method("model.shared.RGBColor", "__reversed__.call", RGBColor, receiver => (receiver as RGBColor).reversed());
method("model.shared.RGBColor", "tuple_value_protocol.call", RGBColor, receiver => [...receiver as RGBColor]);
method("model.shared.RGBColor", "__eq__.call", RGBColor, (receiver, args) => (receiver as RGBColor).equals(args.other instanceof RGBColor ? args.other : RGBColor.from_string(args.other as string)));
for (const [prefix, owner] of [
  ["model.styles.styles.Styles", Styles], ["model.styles.style.BaseStyle", BaseStyle], ["model.styles.style.CharacterStyle", CharacterStyle],
  ["model.styles.style.ParagraphStyle", ParagraphStyle], ["model.styles.style._TableStyle", TableStyle], ["model.styles.style._NumberingStyle", BaseStyle],
  ["model.styles.latent.LatentStyles", LatentStyles], ["model.styles.latent._LatentStyle", LatentStyle], ["model.text.run.Font", Font],
  ["model.text.parfmt.ParagraphFormat", ParagraphFormat], ["model.text.tabstops.TabStops", TabStops], ["model.text.tabstops.TabStop", TabStop], ["model.dml.color.ColorFormat", ColorFormat]
] as const) {
  properties(prefix, owner, ["element", "part"], []);
  method(prefix, "__eq__.call", owner, (receiver, args) => (receiver as { equals(value: unknown): boolean }).equals(args.other));
  method(prefix, "__ne__.call", owner, (receiver, args) => !(receiver as { equals(value: unknown): boolean }).equals(args.other));
}
for (const [name, factory, argument] of [["Length", Length, "emu"], ["Emu", Emu, "emu"], ["Inches", Inches, "inches"], ["Cm", Cm, "cm"], ["Mm", Mm, "mm"], ["Pt", Pt, "points"], ["Twips", Twips, "twips"]] as const) {
  styleModelBatchActions.set(`model.shared.${name}.call`, (_receiver, args) => factory(args[argument] as number));
  for (const key of ["emu", "inches", "cm", "mm", "pt", "twips", "numeric_protocol"] as const) styleModelBatchActions.set(`model.shared.${name}.${key}.get`, receiver => {
    if (!isLength(receiver)) throw new DocxUsageError("Expected an owned length receiver.");
    return receiver[key === "numeric_protocol" ? "emu" : key];
  });
}
for (const [group, family, canonical] of [
  ["style", "WD_STYLE_TYPE", "WD_STYLE_TYPE"], ["style", "WD_BUILTIN_STYLE", "WD_BUILTIN_STYLE"],
  ["text", "WD_UNDERLINE", "WD_UNDERLINE"], ["text", "WD_COLOR_INDEX", "WD_COLOR_INDEX"],
  ["text", "WD_PARAGRAPH_ALIGNMENT", "WD_PARAGRAPH_ALIGNMENT"], ["text", "WD_ALIGN_PARAGRAPH", "WD_PARAGRAPH_ALIGNMENT"],
  ["text", "WD_LINE_SPACING", "WD_LINE_SPACING"], ["text", "WD_TAB_ALIGNMENT", "WD_TAB_ALIGNMENT"], ["text", "WD_TAB_LEADER", "WD_TAB_LEADER"],
  ["dml", "MSO_THEME_COLOR", "MSO_THEME_COLOR"], ["dml", "MSO_THEME_COLOR_INDEX", "MSO_THEME_COLOR"], ["dml", "MSO_COLOR_TYPE", "MSO_COLOR_TYPE"]
] as const) {
  const prefix = `model.enum.${group}.${family}`;
  const members = enumMembers(canonical);
  const symbol = (receiver: unknown) => {
    const found = members.find(member => receiver !== null && typeof receiver === "object" && (Reflect.get(receiver, "enum") === member.enum || Reflect.get(receiver, "enum") === family) && Reflect.get(receiver, "name") === member.name);
    if (!found) throw new DocxUsageError("Expected a symbol from the declared enum family.");
    return found;
  };
  for (const member of members) styleModelBatchActions.set(`${prefix}.${member.name}.get`, () => member);
  styleModelBatchActions.set(`${prefix}.fromValue.call`, (_receiver, args) => enumFromValue(canonical, args.value as number));
  styleModelBatchActions.set(`${prefix}.from_xml.call`, (_receiver, args) => enumFromXml(canonical, args.xmlValue as string | null));
  styleModelBatchActions.set(`${prefix}.name.get`, receiver => symbol(receiver).name);
  styleModelBatchActions.set(`${prefix}.value.get`, receiver => enumValue(symbol(receiver)));
  for (const name of ["__str__", "toString"]) styleModelBatchActions.set(`${prefix}.${name}.call`, receiver => enumString(symbol(receiver)));
  styleModelBatchActions.set(`${prefix}.xml_value.get`, receiver => { const member = symbol(receiver); try { return enumXml(member); } catch (error) { if (error instanceof RangeError) return null; throw error; } });
  styleModelBatchActions.set(`${prefix}.to_xml.call`, (receiver, args) => {
    symbol(receiver); if (args.value === null) return null;
    return enumXml(typeof args.value === "number" ? enumFromValue(canonical, args.value) : symbol(args.value));
  });
  styleModelBatchActions.set(`${prefix}.members.get`, () => new Map(members.map(member => [member.name, member])));
  styleModelBatchActions.set(`${prefix}.Symbol.iterator.call`, () => [...members]);
}
export const styleModelBatchBootstrap = "model.document.Document.styles.get";
export const styleModelBatchOperations: readonly string[] = Object.freeze([styleModelBatchBootstrap, ...styleModelBatchActions.keys(), ...imageBatchActions.keys()].filter(id => docxOperationSchemas[id]));
