import {convert, type ConversionOptions} from "@poe-code/pandoc";
import {pandocCommands, type PandocCommandsOptions} from "@poe-platform/safe-bash/commands/pandoc";
const options: ConversionOptions = {from: "commonmark", to: "plain"};
const plugin: PandocCommandsOptions = {replace: true, limits: {inputBytes: 100}};
void convert([{bytes: new Uint8Array()}], options, {}); void pandocCommands(plugin);
// @ts-expect-error Native engine configuration is not a public conversion option.
void convert([], {from: "commonmark", to: "plain", nativeEngine: "pandoc"}, {});
