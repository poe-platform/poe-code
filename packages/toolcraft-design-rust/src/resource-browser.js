import { createRequire } from "node:module";
import { resolveOutputFormat, stripAnsi } from "./logging.js";
import { createComponentPolicy } from "./component-host.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const operations = {
  undefined: () => undefined, empty: () => "", array: () => [], object: () => ({}),
  field: (object,key) => object[key], nullish: value => value == null,
  optional: (object,key) => ({[key]:stripAnsi(object[key])}),
  optionalMeta: item => ({meta:item.meta.map(stripAnsi)}),
  header: options => options.theme.header(options.title),
  subtitle: options => options.theme.muted(options.subtitle),
  title: (header,subtitle) => [header,subtitle].filter(value=>value !== undefined).join("  "),
  single: value => [value], emptyArray: value => value.length === 0,
  blocks: blocks => blocks.join("\n\n"), lines: lines => lines.join("\n"),
  terminalGroups(options,blocks) {
    for(const group of options.groups) blocks.push(invoke("terminalGroup",[options.theme,group]));
  },
  terminalFooter: (options,blocks) => blocks.push(options.theme.muted(options.footer)),
  groupLines: (theme,group) => [
    `${theme.header(group.title)}  ${theme.muted(String(group.items.length))}`,
    ...invoke("description",[theme,group])
  ],
  description: (theme,group) => [theme.muted(group.description)],
  noItems: () => "No items",
  emptyLines: (theme,group,lines) => lines.push(theme.muted(invoke("emptyHint",[group.emptyHint]))),
  entries(theme,group,lines) {
    for(const [index,item] of group.items.entries()) invoke("entry",[theme,group,lines,index,item]);
  },
  appendItem: (theme,lines,item) => lines.push(...[
    `${theme.accent(">")} ${theme.header(item.label)}${invoke("badge",[theme,item])}`,
    ...invoke("meta",[theme,item]),...invoke("preview",[theme,item])
  ]),
  beforeLast: (index,group) => index < group.items.length - 1,
  separator: lines => lines.push(""),
  badge: (theme,item) => `  ${theme.info(item.badge)}`,
  meta: (theme,item) => [`  ${theme.muted(item.meta.join(" · "))}`],
  preview: (theme,item) => [`  ${theme.muted(item.preview)}`],
  markdownStart: options => [`# ${stripAnsi(options.title)}`],
  markdownSubtitle: (options,blocks) => blocks.push(stripAnsi(options.subtitle)),
  markdownFooter: (options,blocks) => blocks.push(stripAnsi(options.footer)),
  markdownGroups(options,blocks) {
    for(const group of options.groups) {
      invoke("markdownGroup",[group,blocks]);
    }
  },
  markdownHeader: group => [`## ${stripAnsi(group.title)} (${group.items.length})`],
  markdownBlock: (blocks,lines) => blocks.push(lines.join("\n\n")),
  markdownDescription: (group,lines) => lines.push(stripAnsi(group.description)),
  markdownEmpty: (group,lines) => lines.push(stripAnsi(invoke("emptyHint",[group.emptyHint]))),
  markdownItems: (group,lines) => lines.push(...group.items.map(item=>invoke("markdownItem",[item]))),
  markdownMeta: item => ` — ${item.meta.map(stripAnsi).join(" · ")}`,
  markdownPreview: item => `: ${stripAnsi(item.preview)}`,
  markdownItem: (item,meta,preview) => `- **${stripAnsi(item.label)}**${meta}${preview}`,
  json: options => JSON.stringify({
    title:stripAnsi(options.title),...invoke("optional",[options,"subtitle"]),
    groups:options.groups.map(group=>({
      title:stripAnsi(group.title),...invoke("optional",[group,"description"]),...invoke("optional",[group,"emptyHint"]),
      items:group.items.map(item=>({
        label:stripAnsi(item.label),...invoke("optional",[item,"meta"]),...invoke("optional",[item,"preview"]),...invoke("optional",[item,"badge"])
      }))
    })),
    ...invoke("optional",[options,"footer"])
  },null,2),
  invalidOperation() {throw new TypeError("Invalid resource browser operation");}
};
const invoke = createComponentPolicy(native.designResourceBrowserPolicy,operations);
export function renderResourceBrowser(options) {return invoke("render",[options,resolveOutputFormat()]);}
