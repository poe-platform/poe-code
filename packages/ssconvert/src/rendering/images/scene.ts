import { SsconvertError } from "../../contracts.js";
import type { ChartNode } from "../../objects/index.js";

/** Resolved opaque root paint. Plot layout and text require their own renderer. */
export function graphBackground(graph: ChartNode | undefined): string | undefined {
  const unsupported = (): never => { throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: graph scene rendering"); };
  if (!graph) return undefined;
  if (graph.type !== "GogGraph" || graph.children.length || graph.data.length) return unsupported();
  if (!graph.properties.length) return undefined;
  if (graph.properties.length !== 1 || graph.properties[0]!.attributes.name !== "style" || graph.properties[0]!.attributes.type !== "GogStyle") return unsupported();
  const style = graph.style;
  // GogOutlinedView paints the root rectangle only. Font, marker and text
  // layout metadata cannot paint anything without graph children or data.
  if (!style || style.outline) return unsupported();
  if (style.line?.dash !== "none" || style.line["auto-dash"] !== "0") return unsupported();
  const fill = style.fill;
  if (!fill || fill.attributes["auto-type"] !== "0") return unsupported();
  if (fill.attributes.type === "none") return undefined;
  if (fill.attributes.type !== "pattern" || fill.attributes["is-auto"] !== "0" || fill.gradient || fill.image || fill.pattern?.type !== "solid" || fill.pattern["auto-pattern"] !== "0") return unsupported();
  const components = fill.pattern.back?.split(":");
  if (!components || components.length !== 4 || components.some(component => !component.length || component.length > 2 || !Array.from(component).every(char => "0123456789abcdefABCDEF".includes(char)))) return unsupported();
  const channels = components.map(component => Number.parseInt(component, 16));
  if (channels[3] !== 255) return unsupported();
  return "#" + channels.slice(0, 3).map(channel => channel.toString(16).padStart(2, "0")).join("");
}
