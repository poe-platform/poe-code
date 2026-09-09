import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeDictionaryMethod } from "./runtime-dictionary-method.js";
import { createRuntimeDictionaryMutationMethod } from "./runtime-dictionary-mutation-method.js";
import { readRuntimeDictionaryViewAttribute } from "./runtime-dictionary-view-attributes.js";
import { createRuntimeSetAlgebraMethod } from "./runtime-set-algebra-method.js";
import { createRuntimeSetMutationMethod } from "./runtime-set-mutation-method.js";
import { createRuntimeSetRelationMethod } from "./runtime-set-relation-method.js";
import { createRuntimeListMethod } from "./runtime-list-method.js";
import { createRuntimeListSortMethod } from "./runtime-list-sort-method.js";
import { createRuntimeTupleMethod } from "./runtime-tuple-method.js";
import { readRuntimeRangeAttribute } from "./runtime-range-attributes.js";
import { createRuntimeStringSearchMethod } from "./runtime-string-search-method.js";
import { createRuntimeStringAffixMethod } from "./runtime-string-affix-method.js";
import { createRuntimeStringCutMethod } from "./runtime-string-cut-method.js";
import { createRuntimeStringJoinMethod } from "./runtime-string-join-method.js";
import { createRuntimeStringStripMethod } from "./runtime-string-strip-method.js";
import { createRuntimeSplitlinesMethod } from "./runtime-splitlines-method.js";
import { createRuntimeStringSplitMethod } from "./runtime-string-split-method.js";
import { createRuntimeStringReplaceMethod } from "./runtime-string-replace-method.js";
import { createRuntimeStringPadMethod } from "./runtime-string-pad-method.js";
import { createRuntimeExpandtabsMethod } from "./runtime-expandtabs-method.js";
import { createRuntimeStringCaseMethod } from "./runtime-string-case-method.js";
import { createRuntimeBytesCaseMethod } from "./runtime-bytes-case-method.js";
import { createRuntimeBytesClassificationMethod } from "./runtime-bytes-classification-method.js";
import { createRuntimeBytesSearchMethod } from "./runtime-bytes-search-method.js";
import { createRuntimeBytesAffixMethod } from "./runtime-bytes-affix-method.js";
import { createRuntimeBytesCutMethod } from "./runtime-bytes-cut-method.js";
import { createRuntimeBytesJoinMethod } from "./runtime-bytes-join-method.js";
import { createRuntimeBytesStripMethod } from "./runtime-bytes-strip-method.js";
import { createRuntimeStringClassificationMethod } from "./runtime-string-classification-method.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import { isRuntimeSet, type RuntimeValue, type RuntimeValues } from "./runtime-values.js";

/** Default exact-value lookup. Only explicitly implemented Python members are
 * exposed; host payload fields and JavaScript prototypes are never inspected.
 * Custom object policies can replace this operation in expression bindings.
 * Type descriptors, inherited object members and native introspection remain
 * separate from these instance-bound container capabilities. */
export function runtimeNativeAttribute(receiver: RuntimeValue, name: string, values: RuntimeValues, meter: ExecutionMeter, beginCall?: ExpressionContext<RuntimeValue>["beginCall"]): RuntimeValue {
  meter.checkpoint();
  if ((receiver.kind === "str" || receiver.kind === "bytes") && name === "splitlines") return createRuntimeSplitlinesMethod(receiver, values, meter);
  if ((receiver.kind === "str" || receiver.kind === "bytes") && name === "expandtabs") return createRuntimeExpandtabsMethod(receiver, values, meter);
  if (receiver.kind === "bytes") {
    if (name === "strip" || name === "lstrip" || name === "rstrip") return createRuntimeBytesStripMethod(receiver, name, values, meter);
    if (name === "join") return createRuntimeBytesJoinMethod(receiver, values, meter);
    if (name === "removeprefix" || name === "removesuffix" || name === "partition" || name === "rpartition") return createRuntimeBytesCutMethod(receiver, name, values, meter);
    if (name === "startswith" || name === "endswith") return createRuntimeBytesAffixMethod(receiver, name, values, meter);
    if (name === "upper" || name === "lower" || name === "title" || name === "capitalize" || name === "swapcase") return createRuntimeBytesCaseMethod(receiver, name, values, meter);
    switch (name) {
      case "find": case "rfind": case "index": case "rindex": case "count":
        return createRuntimeBytesSearchMethod(receiver, name, values, meter);
      case "isascii": case "isspace": case "isalpha": case "isalnum": case "isdigit": case "islower": case "isupper": case "istitle":
        return createRuntimeBytesClassificationMethod(receiver, name, values, meter);
    }
  }
  if (receiver.kind === "str") {
    if (name === "upper" || name === "casefold" || name === "lower" || name === "title" || name === "capitalize" || name === "swapcase") return createRuntimeStringCaseMethod(receiver, name, values, meter);
    switch (name) {
      case "isascii": case "isspace": case "isidentifier": case "isalpha": case "isdecimal":
      case "isdigit": case "isnumeric": case "isalnum": case "isprintable": case "islower": case "isupper": case "istitle":
        return createRuntimeStringClassificationMethod(receiver, name, values, meter);
    }
    if (name === "center" || name === "ljust" || name === "rjust" || name === "zfill") return createRuntimeStringPadMethod(receiver, name, values, meter);
    if (name === "replace") return createRuntimeStringReplaceMethod(receiver, values, meter);
    if (name === "split" || name === "rsplit") return createRuntimeStringSplitMethod(receiver, name, values, meter);
    if (name === "strip" || name === "lstrip" || name === "rstrip") return createRuntimeStringStripMethod(receiver, name, values, meter);
    if (name === "join") return createRuntimeStringJoinMethod(receiver, values, meter);
    if (name === "removeprefix" || name === "removesuffix" || name === "partition" || name === "rpartition") return createRuntimeStringCutMethod(receiver, name, values, meter);
    if (name === "startswith" || name === "endswith") return createRuntimeStringAffixMethod(receiver, name, values, meter);
    switch (name) {
      case "find": case "rfind": case "index": case "rindex": case "count":
        return createRuntimeStringSearchMethod(receiver, name, values, meter);
    }
  }
  if (receiver.kind === "range") {
    const result = readRuntimeRangeAttribute(receiver, name, values, meter);
    if (result !== undefined) return result;
  }
  if (receiver.kind === "tuple" && (name === "count" || name === "index")) return createRuntimeTupleMethod(receiver, name, values, meter);
  if (receiver.kind === "list") {
    if (name === "sort") return createRuntimeListSortMethod(receiver, values, meter, beginCall);
    switch (name) {
      case "append": case "extend": case "insert": case "pop": case "clear": case "reverse": case "copy": case "count": case "remove": case "index": case "__reversed__":
        return createRuntimeListMethod(receiver, name, values, meter);
    }
  }
  if (receiver.kind === "dict" || receiver.kind === "mappingproxy") {
    switch (name) {
      case "get": case "copy": case "keys": case "values": case "items": case "__reversed__":
        return createRuntimeDictionaryMethod(receiver, name, values, meter);
      case "clear": case "pop": case "popitem": case "setdefault": case "update":
        if (receiver.kind === "dict") return createRuntimeDictionaryMutationMethod(receiver, name, values, meter);
    }
  }
  if (receiver.kind === "dict_keys" || receiver.kind === "dict_items" || receiver.kind === "dict_values") {
    const result = readRuntimeDictionaryViewAttribute(receiver, name, values, meter);
    if (result !== undefined) return result;
  }
  if (isRuntimeSet(receiver)) {
    switch (name) {
      case "copy": case "isdisjoint": case "issubset": case "issuperset":
        return createRuntimeSetRelationMethod(receiver, name, values, meter);
      case "union": case "intersection": case "difference": case "symmetric_difference":
        return createRuntimeSetAlgebraMethod(receiver, name, values, meter);
      case "add": case "remove": case "discard": case "pop": case "clear": case "update":
      case "intersection_update": case "difference_update": case "symmetric_difference_update":
        if (receiver.kind === "set") return createRuntimeSetMutationMethod(receiver, name, values, meter);
    }
  }
  meter.checkpoint(1, 128 + 2 * name.length);
  throw new PythonRuntimeError("AttributeError", `'${receiver.kind}' object has no attribute '${name}'`);
}
