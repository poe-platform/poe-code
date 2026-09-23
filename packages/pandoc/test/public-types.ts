import {convert, createJsonFilterCapability, type JsonFilterRuntime, type ConversionOptions} from "@poe-code/pandoc";
import {pandocCommands, type PandocCommandsOptions} from "@poe-platform/safe-bash/commands/pandoc";
const options: ConversionOptions = {from: "commonmark", to: "plain"};
const plugin: PandocCommandsOptions = {replace: true, limits: {inputBytes: 100}};
void convert([{bytes: new Uint8Array()}], options, {}); void pandocCommands(plugin);
declare const runtime: JsonFilterRuntime;
const filters = createJsonFilterCapability(runtime);
void convert([], {...options, filters: [{kind: "json", path: "filter.py"}]}, {filters});
void pandocCommands({filters});
// @ts-expect-error Native engine configuration is not a public conversion option.
void convert([], {from: "commonmark", to: "plain", nativeEngine: "pandoc"}, {});
