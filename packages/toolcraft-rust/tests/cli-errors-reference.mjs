import {CommanderError} from "commander";
import * as design from "../../toolcraft-design/dist/index.js";
import {formatDebugStack} from "../../toolcraft/dist/stack-trim.js";
import {redactHttpBody,redactHttpHeaderValue} from "../../toolcraft/dist/redaction.js";
import {summarizeHttpError} from "../../toolcraft/dist/api-error-summary.js";
import {original as commands} from "./cli-commands-reference.mjs";
import {loadCLIReference} from "./cli-reference.mjs";
export const original=loadCLIReference([
  "renderCliErrorPattern","handleRunError","formatCommanderErrorMessage","formatUnknownCommandError","appendUsagePointer","formatCliCommandPath","formatUnknownCommandMessage","formatUnknownOptionError","formatSuggestionMessage","extractQuotedCommanderValue","extractBetweenQuotes","findCurrentCommanderCommand","findCurrentCommanderCommandPath","findUnknownCommanderCommand","shouldRejectDefaultCommandToken","hasNonDefaultPublicChildCommand","isBareCommandLikeToken","isCommandNameCharacter","getDefaultCommanderCommandName","configureCommanderSuggestionOutput","toDesignSystemOutput",
  "isPlainObject","isStringRecord","isHttpErrorLike","hasTypedOptionalField","isNonEmptyString","isProblemDetailsLike","isGraphQLErrorEnvelopeLike","hasOwnProperty","hasOwnNonEmptyString","styleHttpErrorLine","formatHttpErrorStatus","formatProblemDetailsBody","formatGraphQLErrorEnvelopeBody","formatHttpErrorBody","indentHttpErrorBlock","formatHttpHeaderValue","formatHttpErrorHeaders","formatHttpErrorSnippet","renderHttpError"
],[],{CommanderError,text:design.text,createLogger:design.createLogger,withOutputFormat:design.withOutputFormat,formatDebugStack,redactHttpBody,redactHttpHeaderValue,summarizeHttpError,getToolcraftHiddenDefaultNames:commands.getToolcraftHiddenDefaultNames,getToolcraftReservedChildNames:commands.getToolcraftReservedChildNames,isToolcraftHiddenCommander:commands.isToolcraftHiddenCommander});
