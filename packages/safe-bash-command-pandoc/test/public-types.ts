import {convert, createJsonFilterCapability, createLuaFilterCapability, resolveConversionArgs, pandocCommands, type LuaScriptLoader, type JsonFilterRuntime, type ConversionOptions, type PandocCommandsOptions} from "safe-bash-command-pandoc";
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

import type {LuaFilterOptions, LuaStreamFilterOptions} from "safe-bash-command-pandoc";
declare const bufferedLuaOptions: LuaFilterOptions;
const compatibleLoader: LuaScriptLoader = bufferedLuaOptions.readFile;
void compatibleLoader;
const streamedLuaOptions: LuaStreamFilterOptions = {readStream: async function* (_path, signal) {
  signal?.throwIfAborted();
  yield new Uint8Array();
}};
const streamedLuaFilters = createLuaFilterCapability(streamedLuaOptions);
void convert([], {...options, filters: [{kind: "lua", path: "filter.lua"}]}, {filters: streamedLuaFilters});
void pandocCommands({filters: streamedLuaFilters});
// Existing reader methods retain their original method variance.
const singleScriptReader: LuaFilterOptions = {readFile: async (_path: "/filter.lua") => new Uint8Array()};
void createLuaFilterCapability(singleScriptReader);

import type {CommandInputs} from "safe-bash-command-pandoc";
const streamedFiles: CommandInputs = {readStream: async function* (_path, signal, maxBytes) {
  signal.throwIfAborted();
  if (maxBytes !== undefined && maxBytes < 1) throw new Error("no byte budget");
  yield Uint8Array.of(65);
}};
void resolveConversionArgs(["document.md"], streamedFiles, new AbortController().signal);

import {convertToOutput, type OutputConversionContext, type ConversionSummary} from "safe-bash-command-pandoc";
declare const outputContext: OutputConversionContext;
const written: ConversionSummary = await convertToOutput([], {from: "csv", to: "html"}, outputContext);
const outputKind: "output" = written.kind;
void outputKind;

import {createFileOutput} from "safe-bash-command-pandoc";
import type {FileSystem, FileStat} from "@poe-code/safe-fs/core";
declare const publicationFs: FileSystem;
declare const publicationParent: FileStat;
void convertToOutput([], {from: "csv", to: "html"}, {
  output: createFileOutput(publicationFs, "/result.html", {expected: null, parent: publicationParent, maxBytes: Infinity})
});
