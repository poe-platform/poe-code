import {convert, createJsonFilterCapability, createLuaFilterCapability, resolveConversionArgs, type LuaScriptLoader, type JsonFilterRuntime, type ConversionOptions} from "safe-bash-command-pandoc";
import {pandocCommands, type PandocCommandsOptions} from "@poe-platform/safe-bash/commands/pandoc";
const options: ConversionOptions = {from: "commonmark", to: "plain"};
const plugin: PandocCommandsOptions = {replace: true, limits: {inputBytes: 100}};
void convert([{bytes: new Uint8Array()}], options, {}); void pandocCommands(plugin);
declare const runtime: JsonFilterRuntime;
const filters = createJsonFilterCapability(runtime);
void convert([], {...options, filters: [{kind: "json", path: "filter.py"}]}, {filters});
void pandocCommands({filters});
const parsed = await resolveConversionArgs([], {}, new AbortController().signal);
void convert(parsed.operands ?? [], parsed.options, {limits: parsed.limits});
declare const loadScript: LuaScriptLoader;
const luaFilters = createLuaFilterCapability(loadScript);
void convert([], {...options, filters: [{kind: "lua", path: "filter.lua"}]}, {filters: luaFilters});
void pandocCommands({filters: luaFilters});
// @ts-expect-error Native engine configuration is not a public conversion option.
void convert([], {from: "commonmark", to: "plain", nativeEngine: "pandoc"}, {});

import {createLuaFilterCapability as createReaderLuaFilterCapability} from "safe-bash-command-pandoc/lua-filters";
const readerLuaFilters = createReaderLuaFilterCapability({readFile: async (_path, _signal) => new Uint8Array()});
void convert([], {...options, filters: [{kind: "lua", path: "filter.lua"}]}, {filters: readerLuaFilters});
void pandocCommands({filters: readerLuaFilters});

import {createCiteprocFilterCapability, type CiteprocFilterOptions} from "safe-bash-command-pandoc/citeproc-filters";
declare const csl: CiteprocFilterOptions;
const citations = createCiteprocFilterCapability(csl);
void convert([], {...options, filters: [{kind: "citeproc"}]}, {filters: citations});
void pandocCommands({filters: citations});
