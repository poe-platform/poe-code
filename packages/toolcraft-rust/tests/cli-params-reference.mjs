import {loadCLIReference} from "./cli-reference.mjs";
import {original as dynamic} from "./cli-dynamic-argv-reference.mjs";
import {original as consume} from "./cli-consume-reference.mjs";
import {loadPresetReference} from "./cli-presets-reference.mjs";
import {loadVariantReference} from "./cli-variants-reference.mjs";
import {throwValidationErrors} from "../../toolcraft/dist/validation-errors.js";
export function loadParamsReference({readFile,promptForField,select,isCancel}){
  return loadCLIReference(["resolveParams","normalizeCommanderOptionValue","hasFieldValue","fieldPromptLabel","withPromptStreams","throwPromptCancellation","formatMissingParameterMessage"],["NULL_OPTION_VALUE"],{
    parseDynamicValues:dynamic.parseDynamicValues,setNestedValue:dynamic.setNestedValue,
    formatFieldValidationIssue:dynamic.formatFieldValidationIssue,
    parseFieldInputValue:consume.parseFieldInputValue,parseOptionFieldValue:consume.parseOptionFieldValue,
    parseScalarValue:consume.parseScalarValue,unwrapOptional:consume.unwrapOptional,
    loadPresetValues:loadPresetReference(readFile).loadPresetValues,
    enforceVariantConstraints:loadVariantReference(promptForField).enforceVariantConstraints,
    throwValidationErrors,promptForField,select,isCancel
  });
}
