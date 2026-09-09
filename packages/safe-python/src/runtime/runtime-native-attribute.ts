import { PythonRuntimeError } from "./error.js";
import { readRuntimeIteratorMethod } from "./runtime-iterator-method.js";
import { createRuntimeNativeRepresentationMethod, hasNativeRepresentation } from "./runtime-native-representation-method.js";
import { createRuntimeFormatContext, hasNativeObjectFormat } from "./runtime-format.js";
import { createRuntimeBraceFormatMethod } from "./runtime-brace-format-method.js";
import { runtimeIndex } from "./runtime-index.js";
import { UnsupportedExpressionError } from "./expression-evaluation.js";
import type { FormatContext } from "./format-protocol.js";
import { createRuntimeNativeFormatMethod } from "./runtime-native-format-method.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeDictionaryMethod } from "./runtime-dictionary-method.js";
import { createRuntimeDictionaryMutationMethod } from "./runtime-dictionary-mutation-method.js";
import { readRuntimeDictionaryViewAttribute } from "./runtime-dictionary-view-attributes.js";
import { createRuntimeSetAlgebraMethod } from "./runtime-set-algebra-method.js";
import { createRuntimeSetMutationMethod } from "./runtime-set-mutation-method.js";
import { createRuntimeSetRelationMethod } from "./runtime-set-relation-method.js";
import { createRuntimeListMethod, type RuntimeListMethodContext } from "./runtime-list-method.js";
import { createRuntimeListSortMethod } from "./runtime-list-sort-method.js";
import { createRuntimeTupleMethod } from "./runtime-tuple-method.js";
import { readRuntimeRangeAttribute } from "./runtime-range-attributes.js";
import { createRuntimeStringSearchMethod } from "./runtime-string-search-method.js";
import { createRuntimeStringAffixMethod } from "./runtime-string-affix-method.js";
import { createRuntimeStringCutMethod } from "./runtime-string-cut-method.js";
import { createRuntimeStringJoinMethod } from "./runtime-string-join-method.js";
import { createRuntimeStringStripMethod } from "./runtime-string-strip-method.js";
import { createRuntimeSplitlinesMethod } from "./runtime-splitlines-method.js";
import { createRuntimeSplitMethod } from "./runtime-split-method.js";
import { createRuntimeStringReplaceMethod } from "./runtime-string-replace-method.js";
import { createRuntimeBytesReplaceMethod } from "./runtime-bytes-replace-method.js";
import { createRuntimeBytesTranslateMethod } from "./runtime-bytes-translate-method.js";
import { createRuntimeBytesMaketransMethod } from "./runtime-bytes-maketrans-method.js";
import { createRuntimeBytesHexMethod } from "./runtime-bytes-hex-method.js";
import { createRuntimeBytesFromhexMethod } from "./runtime-bytes-fromhex-method.js";
import { createRuntimeIntegerBitMethod } from "./runtime-integer-bit-method.js";
import { createRuntimeIntegerRatioMethod } from "./runtime-integer-ratio-method.js";
import { createRuntimeIsIntegerMethod } from "./runtime-is-integer-method.js";
import { createRuntimeConjugateMethod } from "./runtime-conjugate-method.js";
import { runtimeNumericAttribute } from "./runtime-numeric-attribute.js";
import { createRuntimeFloatHexMethod } from "./runtime-float-hex-method.js";
import { createRuntimeFloatFromhexMethod } from "./runtime-float-fromhex-method.js";
import { createRuntimeIntegerToBytesMethod } from "./runtime-integer-to-bytes-method.js";
import { createRuntimeIntegerFromBytesMethod } from "./runtime-integer-from-bytes-method.js";
import { createRuntimePadMethod } from "./runtime-pad-method.js";
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
export function runtimeNativeAttribute(receiver: RuntimeValue, name: string, values: RuntimeValues, meter: ExecutionMeter, beginCall?: ExpressionContext<RuntimeValue>["beginCall"], formatting?: FormatContext<RuntimeValue>, methods?: RuntimeListMethodContext): RuntimeValue {
  meter.checkpoint();
  if (receiver.kind === "str" && (name === "format" || name === "format_map")) {
    const context = formatting ?? createRuntimeFormatContext(values, meter, { defaultRepr() { throw new UnsupportedExpressionError("attribute"); } });
    return createRuntimeBraceFormatMethod(receiver, name, values, meter, context, {
      attribute: (value, key) => runtimeNativeAttribute(value, key, values, meter, beginCall, context),
      getItem: (value, key) => runtimeIndex(value, key, values, meter)
    });
  }
  const iteratorMethod = readRuntimeIteratorMethod(receiver, name, values, meter);
  if (iteratorMethod !== undefined) return iteratorMethod;
  if ((name === "__str__" || name === "__repr__") && hasNativeRepresentation(receiver)) return createRuntimeNativeRepresentationMethod(receiver, name, values, meter);
  if (name === "__format__" && (receiver.kind === "str" || receiver.kind === "int" || receiver.kind === "bool"
    || receiver.kind === "float" || receiver.kind === "complex" || hasNativeObjectFormat(receiver))) return createRuntimeNativeFormatMethod(receiver, values, meter, formatting);
  if ((receiver.kind === "int" || receiver.kind === "bool") && name === "from_bytes") return createRuntimeIntegerFromBytesMethod(receiver.kind === "bool", values, meter);
  if ((receiver.kind === "int" || receiver.kind === "bool") && name === "to_bytes") return createRuntimeIntegerToBytesMethod(receiver, values, meter);
  if (receiver.kind === "float" && name === "fromhex") return createRuntimeFloatFromhexMethod(values, meter);
  if (receiver.kind === "float" && name === "hex") return createRuntimeFloatHexMethod(receiver, values, meter);
  if (receiver.kind === "int" || receiver.kind === "bool" || receiver.kind === "float" || receiver.kind === "complex") {
    const attribute = runtimeNumericAttribute(receiver, name, values, meter);
    if (attribute !== undefined) return attribute;
  }
  if ((receiver.kind === "int" || receiver.kind === "bool" || receiver.kind === "float" || receiver.kind === "complex") && name === "conjugate") return createRuntimeConjugateMethod(receiver, values, meter);
  if ((receiver.kind === "int" || receiver.kind === "bool" || receiver.kind === "float") && name === "is_integer") return createRuntimeIsIntegerMethod(receiver, values, meter);
  if ((receiver.kind === "int" || receiver.kind === "bool" || receiver.kind === "float") && name === "as_integer_ratio") return createRuntimeIntegerRatioMethod(receiver, values, meter);
  if ((receiver.kind === "int" || receiver.kind === "bool") && (name === "bit_length" || name === "bit_count")) return createRuntimeIntegerBitMethod(receiver, name, values, meter);
  if ((receiver.kind === "str" || receiver.kind === "bytes") && name === "splitlines") return createRuntimeSplitlinesMethod(receiver, values, meter, methods?.truth);
  if ((receiver.kind === "str" || receiver.kind === "bytes") && (name === "split" || name === "rsplit")) return createRuntimeSplitMethod(receiver, name, values, meter, methods?.integerIndex);
  if ((receiver.kind === "str" || receiver.kind === "bytes") && name === "expandtabs") return createRuntimeExpandtabsMethod(receiver, values, meter, methods?.integerIndex);
  if ((receiver.kind === "str" || receiver.kind === "bytes") && (name === "center" || name === "ljust" || name === "rjust" || name === "zfill")) return createRuntimePadMethod(receiver, name, values, meter, methods?.integerIndex);
  if (receiver.kind === "bytes") {
    if (name === "fromhex") return createRuntimeBytesFromhexMethod(values, meter);
    if (name === "hex") return createRuntimeBytesHexMethod(receiver, values, meter, methods?.integerIndex);
    if (name === "maketrans") return createRuntimeBytesMaketransMethod(values, meter);
    if (name === "translate") return createRuntimeBytesTranslateMethod(receiver, values, meter);
    if (name === "replace") return createRuntimeBytesReplaceMethod(receiver, values, meter, methods?.integerIndex);
    if (name === "strip" || name === "lstrip" || name === "rstrip") return createRuntimeBytesStripMethod(receiver, name, values, meter);
    if (name === "join") return createRuntimeBytesJoinMethod(receiver, values, meter, methods?.iterate);
    if (name === "removeprefix" || name === "removesuffix" || name === "partition" || name === "rpartition") return createRuntimeBytesCutMethod(receiver, name, values, meter);
    if (name === "startswith" || name === "endswith") return createRuntimeBytesAffixMethod(receiver, name, values, meter, methods?.integerIndex);
    if (name === "upper" || name === "lower" || name === "title" || name === "capitalize" || name === "swapcase") return createRuntimeBytesCaseMethod(receiver, name, values, meter);
    switch (name) {
      case "find": case "rfind": case "index": case "rindex": case "count":
        return createRuntimeBytesSearchMethod(receiver, name, values, meter, methods?.integerIndex);
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
    if (name === "replace") return createRuntimeStringReplaceMethod(receiver, values, meter, methods?.integerIndex);
    if (name === "strip" || name === "lstrip" || name === "rstrip") return createRuntimeStringStripMethod(receiver, name, values, meter);
    if (name === "join") return createRuntimeStringJoinMethod(receiver, values, meter, methods?.iterate);
    if (name === "removeprefix" || name === "removesuffix" || name === "partition" || name === "rpartition") return createRuntimeStringCutMethod(receiver, name, values, meter);
    if (name === "startswith" || name === "endswith") return createRuntimeStringAffixMethod(receiver, name, values, meter, methods?.integerIndex);
    switch (name) {
      case "find": case "rfind": case "index": case "rindex": case "count":
        return createRuntimeStringSearchMethod(receiver, name, values, meter, methods?.integerIndex);
    }
  }
  if (receiver.kind === "range") {
    const result = readRuntimeRangeAttribute(receiver, name, values, meter);
    if (result !== undefined) return result;
  }
  if (receiver.kind === "tuple" && (name === "count" || name === "index")) return createRuntimeTupleMethod(receiver, name, values, meter, methods);
  if (receiver.kind === "list") {
    if (name === "sort") return createRuntimeListSortMethod(receiver, values, meter, beginCall);
    switch (name) {
      case "append": case "extend": case "insert": case "pop": case "clear": case "reverse": case "copy": case "count": case "remove": case "index": case "__reversed__":
        return createRuntimeListMethod(receiver, name, values, meter, methods);
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
