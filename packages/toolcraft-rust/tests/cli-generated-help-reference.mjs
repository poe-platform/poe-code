import path from "node:path";
import * as design from "../../toolcraft-design/dist/index.js";
import {loadCLIReference} from "./cli-reference.mjs";
import {original as fields} from "./cli-help-reference.mjs";
import {original as commands} from "./cli-commands-reference.mjs";
export const original=loadCLIReference([
  "resolveHelpOutput","getHelpChildren","findVisibleChild","resolveHelpTarget","formatUnknownHelpCommandMessage","formatSuggestionMessage",
  "formatSecretRows","formatSecretDescription","formatExampleValue","formatExampleCommand","formatExampleRows",
  "wrapOptionalParameterTokens","createCommandParameterToken","formatCommandDynamicParameterTokens","formatCommandParameterTokens","collapseOptionalParameterTokens","formatCommandRowNameTokens","formatCommandRows",
  "formatGlobalOptionsLine","formatLeafGlobalOptionsLine","collectSchemaGlobalFieldRows","renderHelpSections","formatHelpCommandList","formatHelpOptionList","sortLeafHelpOptionFields","buildUsageLine","formatGroupUsageSuffix","formatHelpDrillDownFooter","formatStyledUsageLine",
  "renderGroupHelp","renderLeafHelp","renderJsonHelp","formatJsonHelpOption","renderHelpDocument","renderGeneratedHelp","resolveCLIControls","validateOutputFormats","getGlobalLongOptionFlags","inferProgramName","toDesignSystemOutput"
],["MAX_INLINE_OPTIONAL_PARAMETER_TOKENS","DEFAULT_HELP_TOTAL_WIDTH","BUILT_IN_OUTPUT_FORMATS"],{
  path,...Object.fromEntries(Object.entries(fields).filter(([name])=>!["splitWords","formatCLIName","unwrapOptional"].includes(name))),
  collectFields:commands.collectFields,assignPositionals:commands.assignPositionals,isNodeVisibleInScope:commands.isNodeVisibleInScope,getVisibleChildren:commands.getVisibleChildren,outputFormatNames:commands.outputFormatNames,
  text:design.text,formatCommandList:design.formatCommandList,formatOptionList:design.formatOptionList,helpFormatterPlain:design.helpFormatterPlain,renderHelpTokens:design.renderHelpTokens,withOutputFormat:design.withOutputFormat
});
