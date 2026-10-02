import {loadCLIReference} from "./cli-reference.mjs";
export function loadPromptReference(prompts){
  return loadCLIReference(["promptForField","fieldPromptLabel","enumOptionLabel","formatResolvedValue","withPromptStreams","throwPromptCancellation","parseArrayValue","parseScalarValue","unwrapOptional","splitArrayInput","parseBooleanText","parseEnumValue","validateStringPattern","matchesStringPattern","parseJsonText","describeReceived","getErrorMessage","validateArrayBounds"],[],prompts);
}
