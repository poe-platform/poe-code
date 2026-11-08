import {loadCLIReference} from "./cli-reference.mjs";
export const original=loadCLIReference([
  "splitWords","formatCLIName","unwrapOptional","formatOptionFlags","formatPositionalToken",
  "formatHelpFieldFlags","appendHelpMetadata","normalizeHelpEchoKey","isEchoHelpDescription",
  "suppressEchoHelpDescription","formatHelpFieldDescription","describeKnownStringFormat",
  "describeKnownStringPattern","stripLongOptionPrefix","getLastSegment","matchesFieldNameSuffix",
  "describeFieldNameValueToken","describeHelpValueToken","formatCompactEnumSignatureToken",
  "formatCommandParameterFieldFlags","describeDynamicFieldType","formatDynamicHelpMetadata",
  "createHelpOptionRow","collectDynamicObjectHelpRows","formatDynamicHelpFields","tokenizeHelpFlags",
  "formatResolvedValue","formatCLIEnumChoices","formatJsonHelpSchemaType"
]);
