import { createRequire } from "node:module";
import { resolveOutputFormat, stripAnsi } from "./logging.js";
import { text } from "./text.js";
import { createComponentPolicy } from "./component-host.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const operations = {
  undefined: () => undefined, empty: () => "", array: () => [], object: () => ({}),
  field: (object,key) => object[key], string: value => typeof value === "string",
  optional: (object,key) => ({[key]:stripAnsi(object[key])}),
  tone: (theme,value,tone) => theme[tone](value),
  header: options => options.theme.header(options.title),
  subtitle: options => options.theme.muted(options.subtitle),
  title: (header,subtitle) => [header,subtitle].filter(value=>value !== undefined).join("  "),
  hasMetrics: options => !!options.metrics?.length,
  metrics(options) {
    const metrics=options.metrics,theme=options.theme;
    return metrics.map(metric=>invoke("tone",[theme,`${metric.value} ${metric.label}`,metric.tone])).join(theme.muted(" · "));
  },
  start: (title,metrics) => [[title,metrics].filter(value=>value !== undefined).join("\n")],
  terminalGroups(options,blocks) {
    for(const group of options.groups) {
      invoke("group",[options,group,blocks]);
    }
  },
  blocks: blocks => blocks.join("\n\n"),
  labelWidth: group => Math.max(...group.items.map(item=>item.label.length),0),
  valueWidth: group => Math.max(...group.items.map(item=>item.value.length),0),
  groupLines(options,group,labelWidth,valueWidth,blocks) {
    const lines=[
      `${options.theme.header(group.title)}  ${options.theme.muted(String(group.items.length))}`,
      ...invoke("description",[options,group]),
      ...group.items.map(item=>invoke("item",[options,item,labelWidth,valueWidth]))
    ];
    blocks.push(lines.join("\n"));
  },
  description: (options,group) => [options.theme.muted(group.description)],
  identity: (options,item,labelWidth,valueWidth) => `${invoke("tone",[options.theme,item.label.padEnd(labelWidth),item.tone])}  ${item.value.padEnd(valueWidth)}`,
  trimEnd: identity => identity.trimEnd(),
  detail: (options,item,identity) => `${identity}  ${options.theme.muted(item.detail)}`,
  markdownStart: options => [`# ${stripAnsi(options.title)}`],
  markdownSubtitle: (options,blocks) => blocks.push(stripAnsi(options.subtitle)),
  markdownMetrics: (options,blocks) => blocks.push(`**${options.metrics.map(metric=>`${metric.value} ${metric.label}`).join(" · ")}**`),
  markdownGroups(options,blocks) {
    for(const group of options.groups) {
      invoke("markdownGroup",[group,blocks]);
    }
  },
  markdownHeader: group => [`## ${stripAnsi(group.title)} (${group.items.length})`],
  markdownDescription: (group,header) => header.push(stripAnsi(group.description)),
  markdownItems: group => group.items.map(item=>invoke("markdownItem",[item])),
  markdownGroup: (header,items,blocks) => blocks.push(`${header.join("\n\n")}\n\n${items.join("\n")}`),
  markdownDetail: item => ` — ${stripAnsi(item.detail)}`,
  markdownItem: (item,detail) => `- ${text.command(stripAnsi(item.label))} ${text.command(stripAnsi(item.value))}${detail}`,
  strippedValue: metric => stripAnsi(metric.value),
  json: options => JSON.stringify({
    title:stripAnsi(options.title),
    ...invoke("optional",[options,"subtitle"]),
    metrics:(options.metrics ?? []).map(metric=>({...metric,label:stripAnsi(metric.label),value:invoke("metricValue",[metric])})),
    groups:options.groups.map(group=>({
      title:stripAnsi(group.title),...invoke("optional",[group,"description"]),
      items:group.items.map(item=>({...item,label:stripAnsi(item.label),value:stripAnsi(item.value),...invoke("optional",[item,"detail"])}))
    }))
  },null,2),
  invalidOperation() {throw new TypeError("Invalid catalog operation");}
};
const invoke = createComponentPolicy(native.designCatalogPolicy,operations);
export function renderCatalog(options) {return invoke("render",[options,resolveOutputFormat()]);}
