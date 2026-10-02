import * as native from "../dist/index.js";
import * as cliPolicy from "../dist/cli-policy.js";
import * as cliFields from "../dist/cli-fields.js";
import * as cliHelp from "../dist/cli-help-fields.js";
import * as cliValues from "../dist/cli-values.js";
const parsedCLIScalar:string|number|boolean|null=cliValues.parseScalarValue("17",native.S.Number(),"value");
const parsedCLIArray:unknown[]=cliValues.parseArrayValue("1,2",native.S.Array(native.S.Number()),"items");
const parsedCLIJson:unknown=cliValues.parseJsonText("{}","data");
const checkedCLIString:string=cliValues.validateStringPattern("name",native.S.String(),"value");
cliValues.validateArrayBounds(parsedCLIArray,native.S.Array(native.S.Number()),"items");
// @ts-expect-error scalar parsing rejects object schemas
cliValues.parseScalarValue("{}",native.S.Object({}),"value");
void [parsedCLIScalar,parsedCLIArray,parsedCLIJson,checkedCLIString];
import * as cliArgv from "../dist/cli-argv.js";
import {Option as CLIOption} from "commander";
const numericCLIOption=new CLIOption("-n, --numbers <values...>");
const normalizedCLIArgv:string[]=cliArgv.normalizeNumericArrayOptions(["--numbers","-1","-2"],[numericCLIOption],new Set([numericCLIOption]));
const numericCLIToken:boolean=cliArgv.isNextArrayOptionToken("-1",native.S.Array(native.S.Number()));
const splitCLI:string[]=cliArgv.splitArrayInput("one,two");
const cliOutputMode:import("../dist/renderer.js").OutputMode=cliArgv.resolveOutputFromArgv(["--output=compact"],{compact:()=>""});
const debugCLI:"trim"|"raw"|undefined=cliArgv.getDebugStackModeFromArgv(["node","app","--debug=raw"]);
// @ts-expect-error array option scanning requires an array schema
cliArgv.isNextArrayOptionToken("-1",native.S.Number());
void [normalizedCLIArgv,numericCLIToken,splitCLI,cliOutputMode,debugCLI];
const collectedCLI=cliFields.collectFields(native.S.Object({path:native.S.String(),names:native.S.Array(native.S.String())}),"kebab",new Set(["--yes"]));
const positionalCLI:cliFields.FieldDefinition[]=cliFields.assignPositionals(collectedCLI.fields,["path","names"]);
cliFields.validateUniqueOptionFlags(positionalCLI,new Set());
const flagsCLI:string=cliFields.formatOptionFlags(positionalCLI[0]!,new Set());
const cliHelpFlags:string=cliHelp.formatHelpFieldFlags(positionalCLI[0]!,new Set());
const cliHelpTokens:import("toolcraft-design").HelpToken[]=cliHelp.tokenizeHelpFlags(cliHelpFlags);
const cliHelpDescription:string=cliHelp.formatHelpFieldDescription(positionalCLI[0]!);
const cliDynamicRows:cliHelp.HelpOptionRow[]=collectedCLI.dynamicFields.flatMap(field=>cliHelp.formatDynamicHelpFields(field,"kebab"));
// @ts-expect-error enum choice lists require an enum schema
cliHelp.formatCLIEnumChoices(native.S.String());
void [cliHelpTokens,cliHelpDescription,cliDynamicRows];
// @ts-expect-error CLI traversal starts from an object schema
cliFields.collectFields(native.S.String(),"kebab",new Set());
void flagsCLI;
import type * as referenceCLI from "toolcraft/cli";
import * as cliSnapshot from "../dist/cli-snapshot.js";
const snapshotNative: typeof cliSnapshot.createCLICommandTreeSnapshot = {} as typeof referenceCLI.createCLICommandTreeSnapshot;
const snapshotReference: typeof referenceCLI.createCLICommandTreeSnapshot = cliSnapshot.createCLICommandTreeSnapshot;
const snapshotOptionsNative: cliSnapshot.CLICommandTreeSnapshotOptions = {} as referenceCLI.CLICommandTreeSnapshotOptions;
const snapshotOptionsReference: referenceCLI.CLICommandTreeSnapshotOptions = {} as cliSnapshot.CLICommandTreeSnapshotOptions;
const snapshotNodeNative: cliSnapshot.CLICommandTreeSnapshotNode = {} as referenceCLI.CLICommandTreeSnapshotNode;
const snapshotNodeReference: referenceCLI.CLICommandTreeSnapshotNode = {} as cliSnapshot.CLICommandTreeSnapshotNode;
const snapshotResult: Promise<referenceCLI.CLICommandTreeSnapshot> = cliSnapshot.createCLICommandTreeSnapshot(native.defineGroup({name:"root",children:[]}),{argv:["node","toolcraft"],casing:"snake"});
// @ts-expect-error snapshot roots must be groups
cliSnapshot.createCLICommandTreeSnapshot("root");
void [snapshotNative,snapshotReference,snapshotOptionsNative,snapshotOptionsReference,snapshotNodeNative,snapshotNodeReference,snapshotResult];
const cliControlsNative: cliPolicy.CLIControls = {} as referenceCLI.CLIControls;
const cliControlsReference: referenceCLI.CLIControls = {} as cliPolicy.CLIControls;
const cliOutputContextNative: cliPolicy.CLIOutputFormatContext = {} as referenceCLI.CLIOutputFormatContext;
const cliOutputContextReference: referenceCLI.CLIOutputFormatContext = {} as cliPolicy.CLIOutputFormatContext;
const cliSnapshotOptionNative: cliPolicy.CLICommandTreeSnapshotOption = {} as referenceCLI.CLICommandTreeSnapshotOption;
const cliSnapshotOptionReference: referenceCLI.CLICommandTreeSnapshotOption = {} as cliPolicy.CLICommandTreeSnapshotOption;
const cliResolved=cliPolicy.resolveCLIControls({help:"concise",output:{formats:{compact:context=>String(context.result)}}});
const cliFlags: ReadonlySet<string> = cliPolicy.getGlobalLongOptionFlags(true,false,cliResolved);
const cliOptions: referenceCLI.CLICommandTreeSnapshotOption[] = cliPolicy.createGlobalSnapshotOptions(false,true,cliResolved);
const cliName: string = cliPolicy.formatCLIName("HTTPServer","snake");
// @ts-expect-error CLI names only support kebab and snake casing
cliPolicy.formatCLIName("name","camel");
// @ts-expect-error custom output renderers return strings or undefined
cliPolicy.resolveCLIControls({output:{formats:{invalid:()=>17}}});
void [cliControlsNative,cliControlsReference,cliOutputContextNative,cliOutputContextReference,cliSnapshotOptionNative,cliSnapshotOptionReference,cliFlags,cliOptions,cliName];
import * as logging from "../../toolcraft/dist/runtime-logging.js";
import * as errors from "../../toolcraft/dist/http-errors.js";
import * as suggestions from "../../toolcraft/dist/suggest.js";
import * as userErrors from "../../toolcraft/dist/user-error.js";
import * as sourceSnippet from "toolcraft-rust/source-snippet";
import * as originalSnippet from "toolcraft/source-snippet";
import { S } from "toolcraft-schema";
import * as nativeSchema from "toolcraft-rust/schema";
import * as originalSchema from "toolcraft/schema";
import * as fileChanges from "toolcraft-rust/file-changes";
import * as originalFileChanges from "toolcraft/file-changes";
const fileRenderersOriginal: typeof originalFileChanges = fileChanges;
const fileRenderersOwn: typeof fileChanges = originalFileChanges;
const fileRenderer = fileChanges.createFileChangeRenderers<{ changes: readonly native.FileChange[]; revision: string }>();
const fileResult = { changes: [], revision: "main" };
const unchanged: unknown = fileRenderer.json?.(fileResult, {} as never);
void [fileRenderersOriginal, fileRenderersOwn, unchanged];

const nativeSchemaExports: typeof originalSchema = nativeSchema;
const originalSchemaExports: typeof nativeSchema = originalSchema;
const publicSchema: native.AnySchema = native.S.Object({ label: native.S.String() });
const eventSchema = nativeSchema.S.Object({ label: nativeSchema.S.String() });
const eventValue: native.Static<typeof eventSchema> = { label: "ready" };
void [nativeSchemaExports, originalSchemaExports, publicSchema, eventSchema, eventValue];

const managedStream: typeof import("toolcraft").createManagedStream = native.createManagedStream;
const originalStream: typeof native.createManagedStream = managedStream;
void originalStream;
const events = native.createManagedStream({
  eventSchema: S.Object({ message: S.String() }),
  create: async () => (async function* () { yield { message: "hello" }; })()
});
const typedEvents: native.ToolcraftStream<{ message: string }> = events;
const streamSignal: AbortSignal = typedEvents.signal;
const cancelled: Promise<void> = typedEvents.cancel({ reason: "done" });
void [streamSignal, cancelled];

const renderSnippet: typeof originalSnippet.renderSourceSnippet = sourceSnippet.renderSourceSnippet;
const nativeSnippet: typeof sourceSnippet.renderSourceSnippet = originalSnippet.renderSourceSnippet;
void [renderSnippet, nativeSnippet];
sourceSnippet.renderSourceSnippet({ source: "one\ntwo", line: 2, column: 3, context: 1, filePath: "example.ts" });
// @ts-expect-error source and line are required
sourceSnippet.renderSourceSnippet({ source: "one" });

const expected: Pick<
  typeof native,
  | keyof typeof errors
  | keyof typeof suggestions
  | keyof typeof userErrors
  | "createRuntimeLogger"
  | "isLogLevel"
  | "shouldEmitDiagnostic"
> = { ...logging, ...errors, ...suggestions, ...userErrors };
const actual: typeof expected = native;
const original: Pick<
  typeof logging,
  "createRuntimeLogger" | "isLogLevel" | "shouldEmitDiagnostic"
> &
  typeof errors &
  typeof suggestions &
  typeof userErrors = actual;
void [original, expected];

const level: string = "warn";
if (native.isLogLevel(level)) {
  const narrowed: native.LogLevel = level;
  void narrowed;
}
native.createRuntimeLogger({
  logger: (event) => {
    const message: string = event.message;
    void message;
  }
});
// @ts-expect-error diagnostic events cannot use silent as an event level
native.createRuntimeLogger().emit({ level: "silent", message: "silent" });


import * as design from "toolcraft-rust/design";
import {renderTable as designTable, type TableColumn} from "toolcraft-rust/design/render-table";
import {renderMarkdownPlaintext as designPlaintext} from "toolcraft-rust/design/render-markdown-plaintext";
import {singleDetail as designSingleDetail, type Row as DesignRow} from "toolcraft-rust/design/single-detail";
import type {SelectOptions as DesignSelectOptions} from "toolcraft-rust/design/select";
import type {ExplorerConfig as DesignExplorerConfig} from "toolcraft-rust/design/run-explorer";
const designTableOriginal: typeof import("toolcraft/design/render-table").renderTable = designTable;
const designTableOwn: typeof designTable = null as unknown as typeof import("toolcraft/design/render-table").renderTable;
const designColumns: TableColumn[] = [{name:"name",title:"Name",alignment:"left",maxLen:40}];
const designRendered: string = designTable({theme:design.getTheme(),rows:[{name:"Example"}],columns:designColumns});
const designPlain: string = designPlaintext("# Heading");
const designTheme: typeof import("toolcraft-design-rust").getTheme = design.getTheme;
const designSelection: DesignSelectOptions<"one"|"two"> = {message:"Pick",options:[{value:"one",label:"One"},{value:"two",label:"Two"}]};
const designRows: DesignRow[] = [{id:"a",title:"A"}];
const designExplorer: DesignExplorerConfig<{title:string}> = {title:"Example",actions:[],rows:async()=>designRows,detail:designSingleDetail(row=>row.title)};
// @ts-expect-error selection values must preserve the caller's option type
const invalidDesignSelection: DesignSelectOptions<"one"> = {message:"Pick",options:[{value:"two",label:"Two"}]};
void [designTableOriginal,designTableOwn,designRendered,designPlain,designTheme,designSelection,designExplorer,invalidDesignSelection];

import * as stackTrim from "../dist/stack-trim.js";
import type * as referenceStackTrim from "../../toolcraft/dist/stack-trim.js";
const stackTrimOriginal: typeof referenceStackTrim = stackTrim;
const stackTrimNative: typeof stackTrim = null as unknown as typeof referenceStackTrim;
const stackMode: referenceStackTrim.DebugStackMode = null as unknown as import("../dist/stack-trim.js").DebugStackMode;
void [stackTrimOriginal,stackTrimNative,stackMode];

import * as numberSchema from "../dist/number-schema.js";
import type * as referenceNumberSchema from "../../toolcraft/dist/number-schema.js";
const numberSchemaOriginal: typeof referenceNumberSchema = numberSchema;
const numberSchemaNative: typeof numberSchema = null as unknown as typeof referenceNumberSchema;
void [numberSchemaOriginal,numberSchemaNative];

import * as renderer from "../dist/renderer.js";
import type * as referenceRenderer from "../../toolcraft/dist/renderer.js";
const rendererOriginal: typeof referenceRenderer = renderer;
const rendererNative: typeof renderer = null as unknown as typeof referenceRenderer;
const outputMode: referenceRenderer.OutputMode = null as unknown as import("../dist/renderer.js").OutputMode;
const renderStatus: referenceRenderer.RenderResultStatus = null as unknown as import("../dist/renderer.js").RenderResultStatus;
void [rendererOriginal,rendererNative,outputMode,renderStatus];

import * as jsonErrors from "../dist/cli-json-errors.js";
const jsonLocation: jsonErrors.JsonParseLocation | null = jsonErrors.getJsonParseErrorLocation(new Error("invalid at position 2"),"{x}");
const causeLocation: jsonErrors.JsonParseLocation | null = jsonErrors.getJsonParseCauseLocation({cause:{line:1,col:2}});
const jsonPosition: number | null = jsonErrors.getJsonParseMessagePosition("invalid at position 2");
const numericPosition: number | null = jsonErrors.getNumericProperty({position:2},"position");
const sourceLocation: jsonErrors.JsonParseLocation = jsonErrors.getSourceOffsetLocation("{x}",2);
const jsonDiagnostic: string = jsonErrors.formatJsonParseUserErrorMessage("Preset","preset.json","{x}",new Error("invalid"),{quotePath:true});
const jsonMessage: string = jsonErrors.removeNativeJsonParseLocation("invalid (line 1 column 2)",sourceLocation);
const asciiDigit: boolean = jsonErrors.isAsciiDigit("2");
// @ts-expect-error path quoting must be explicitly selected
jsonErrors.formatJsonParseUserErrorMessage("Preset","preset.json","{x}",null,{});
// @ts-expect-error source offsets must be numeric
jsonErrors.getSourceOffsetLocation("{x}","2");
void [jsonLocation,causeLocation,jsonPosition,numericPosition,jsonDiagnostic,jsonMessage,asciiDigit];

import * as optionConstruction from "../dist/cli-options.js";
const constructedOptions: import("commander").Option[] = optionConstruction.createOption(null as unknown as import("../dist/cli-fields.js").FieldDefinition,new Set<string>());
const constructedOption: import("commander").Option = optionConstruction.createCommanderOption("--value <value>",undefined,null as unknown as import("../dist/cli-fields.js").FieldDefinition);
// @ts-expect-error option construction requires a set of global flags
optionConstruction.createOption(null as unknown as import("../dist/cli-fields.js").FieldDefinition,["--help"]);
void [constructedOptions,constructedOption];

import * as fieldConsumption from "../dist/cli-consume.js";
const consumedValue: {nextIndex:number;value:unknown} = fieldConsumption.consumeFieldValue(["--count","3"],0,native.S.Number(),"count");
const fieldInput: unknown = fieldConsumption.parseFieldInputValue("{\"value\":1}",native.S.Json(),"config");
const fieldErrors: fieldConsumption.CLIFieldValidationError[] = [];
const parsedOption = fieldConsumption.parseOptionFieldValue(null as unknown as import("../dist/cli-fields.js").FieldDefinition,"3",fieldErrors);
if(parsedOption.ok){const parsedValue:unknown=parsedOption.value;void parsedValue;}
// @ts-expect-error field indices must be numeric
fieldConsumption.consumeFieldValue([],"0",native.S.String(),"name");
void [consumedValue,fieldInput];

import * as dynamicPaths from "../dist/cli-dynamic-paths.js";
const dynamicLeaf: dynamicPaths.DynamicCLILeaf = dynamicPaths.resolveDynamicLeaf(native.S.Object({userName:native.S.String()}),["user-name"],"kebab");
const dynamicMatch: {match:import("../dist/cli-fields.js").DynamicFieldDefinition;leaf:dynamicPaths.DynamicCLILeaf}|undefined = dynamicPaths.resolveDynamicOption([],"config.name","snake");
const numericSelector:boolean=dynamicPaths.isNumericFixtureSelector("12");
const qualifiedPath:string=dynamicPaths.qualifyDisplayPath("config","name");
// @ts-expect-error CLI path casing is kebab or snake
dynamicPaths.resolveDynamicLeaf(native.S.String(),[],"camel");
void [dynamicLeaf,dynamicMatch,numericSelector,qualifiedPath];

import * as dynamicValues from "../dist/cli-dynamic-values.js";
const finalizedCliValue:unknown=dynamicValues.finalizeDynamicValue(native.S.Record(native.S.String()),{name:"value"},"config",fieldErrors);
const cliValidationIssue:fieldConsumption.CLIFieldValidationError=dynamicValues.formatFieldValidationIssue({path:["name"],expected:"string",received:"number",message:"invalid"},"config");
// @ts-expect-error collected errors must have path and message fields
dynamicValues.finalizeDynamicValue(native.S.String(),"value","name",[{}]);
void [finalizedCliValue,cliValidationIssue];

import * as dynamicArgv from "../dist/cli-dynamic-argv.js";
const parsedDynamicArgv:{providedFieldIds:Set<string>;values:Map<string,unknown>;positionals:string[]}=dynamicArgv.parseDynamicValues([],[],"kebab",fieldErrors);
const nestedTarget:Record<string,unknown>={};
const nestedAssignment:void=dynamicArgv.setNestedValue(nestedTarget,["config","name"],"value");
// @ts-expect-error dynamic flags use CLI casing rather than SDK camel casing
dynamicArgv.parseDynamicValues([],[],"camel",fieldErrors);
void [parsedDynamicArgv,nestedAssignment];

import * as cliPreparation from "../dist/cli-prepare.js";
const commanderProgram=null as unknown as import("commander").Command;
const preparedCliArgv:{argv:string[];helpArgv?:string[]}=cliPreparation.prepareCliArguments(commanderProgram,[],new Map(),"kebab",null as unknown as import("../dist/cli-policy.js").ResolvedCLIControls);
const defaultCommandName:string|undefined=cliPreparation.getDefaultCommanderCommandName(commanderProgram);
// @ts-expect-error CLI preparation requires command-keyed dynamic field loaders
cliPreparation.prepareCliArguments(commanderProgram,[],new Map<string,()=>[]>(),"kebab",null as unknown as import("../dist/cli-policy.js").ResolvedCLIControls);
void [preparedCliArgv,defaultCommandName];

import * as cliCommands from "../dist/cli-commands.js";
const nodeCommand:import("commander").Command|null=cliCommands.createNodeCommand(null as unknown as native.Command<{service:string},any,any,any>,"kebab",new Set(),async state=>{
  const path:string=state.commandPath;
  const declared:readonly string[]=state.declarationPath;
  const fields:import("../dist/cli-fields.js").FieldDefinition[]=state.fields;
  void [path,declared,fields];
},false,null as unknown as import("../dist/cli-policy.js").ResolvedCLIControls,new Map());
const debugMode:"trim"|"raw"=cliCommands.parseDebugStackMode(true);
const parsedLogLevel:native.LogLevel=cliCommands.parseLogLevel("warn");
// @ts-expect-error CLI execution callbacks must return a promise
cliCommands.createNodeCommand(null as unknown as native.Group,"kebab",new Set(),()=>undefined,false,null as unknown as import("../dist/cli-policy.js").ResolvedCLIControls,new Map());
void [nodeCommand,debugMode,parsedLogLevel];

import * as cliPrompts from "../dist/cli-prompts.js";
const promptedValue:Promise<unknown>=cliPrompts.promptForField(null as unknown as import("../dist/cli-fields.js").FieldDefinition,{});
const promptLabel:string=cliPrompts.fieldPromptLabel(null as unknown as import("../dist/cli-fields.js").FieldDefinition);
const promptOptions:{message:string}&cliPrompts.PromptStreams=cliPrompts.withPromptStreams({message:"Value"},{input:process.stdin,output:process.stdout});
// @ts-expect-error prompt stream options require a readable stream
cliPrompts.withPromptStreams({message:"Value"},{input:17});
void [promptedValue,promptLabel,promptOptions];

import * as cliVariants from "../dist/cli-variants.js";
const constrainedParams:Promise<void>=cliVariants.enforceVariantConstraints({},[],[],[],new Map<string,unknown>(),new Set<string>(),new Set<string>(),false,fieldErrors,{});
const nestedFieldValue:unknown=cliVariants.getNestedValue({nested:{name:"value"}},["nested","name"]);
// @ts-expect-error variant branch tracking uses string field IDs
cliVariants.enforceVariantConstraints({},[],[],[],new Map<string,unknown>(),new Set<number>(),new Set<string>(),false,fieldErrors,{});
void [constrainedParams,nestedFieldValue];

import * as cliPresets from "../dist/cli-presets.js";
const presetValues:Promise<{fields:Record<string,unknown>;dynamic:Map<string,unknown>}>=cliPresets.loadPresetValues([],[],"config.json");
const presetScalar:string|number|boolean|null=cliPresets.validatePresetScalarValue(3,{kind:"number"},"count","config.json");
const presetField:unknown=cliPresets.validatePresetFieldValue([],null as unknown as import("../dist/cli-fields.js").FieldDefinition,"config.json");
// @ts-expect-error preset loading requires a file path
cliPresets.loadPresetValues([],[],17);
// @ts-expect-error scalar presets do not accept object schemas
cliPresets.validatePresetScalarValue({},{kind:"object",shape:{}},"value","config.json");
void [presetValues,presetScalar,presetField];
