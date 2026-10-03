import {loadMCPMetadataReference} from "./mcp-metadata-reference.mjs";
import {cloneDefaultValue,formatIssues,isPlainRecord,nativeJsonSchema,toJsonSchema,unicodeLength,validate} from "../../toolcraft-schema/dist/index.js";
import {ToolError,JSON_RPC_ERROR_CODES} from "tiny-stdio-mcp-server";
import {suggest} from "../../toolcraft/dist/suggest.js";
import {getExpectedNumberDescription,isValidNumberSchemaValue} from "../../toolcraft/dist/number-schema.js";
import {validateAppliedDefault} from "../../toolcraft/dist/applied-default.js";
import {resolveDiscriminatedBranch} from "../../toolcraft/dist/discriminator.js";
import {validateUnionSchema} from "../../toolcraft/dist/union-validation.js";
import {throwValidationErrors} from "../../toolcraft/dist/validation-errors.js";
export const reference=loadMCPMetadataReference([
  "splitWords","formatSegment","unwrapOptional","isOptional","formatAvailableList",
  "formatEnumError","formatEnumSuggestionLine","describeReceived","validateNativeMCPValue",
  "validateSchemaValue","validateStringConstraints","validateArrayConstraints","validateObjectSchema","validateToolArguments",
  "serializeResultValue","serializeResultObject","validateCommandResult","throwResultValidationErrors","applySchemaCasing"
],{cloneDefaultValue,ToolError,JSON_RPC_ERROR_CODES,formatIssues,isPlainRecord,nativeJsonSchema,toJsonSchema,unicodeLength,validate,suggest,getExpectedNumberDescription,isValidNumberSchemaValue,validateAppliedDefault,resolveDiscriminatedBranch,validateUnionSchema,throwValidationErrors});
