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
import { createDictionaryFromKeysBuiltin } from "./builtin-dictionary-fromkeys.js";
import { readRuntimeDictionaryViewAttribute } from "./runtime-dictionary-view-attributes.js";
import { readRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";
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
import type { RuntimeBytesInputContext } from "./runtime-bytes-input.js";
import { createRuntimeStringTranslateMethod, type RuntimeStringTranslationContext } from "./runtime-string-translate-method.js";
import { createRuntimeStringMaketransMethod } from "./runtime-string-maketrans-method.js";
import type { RuntimeBufferContext } from "./runtime-buffer-context.js";
import { isRuntimeSet, type RuntimeValue, type RuntimeValues } from "./runtime-values.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import { RuntimeAttributeStorage } from "./runtime-attribute-storage.js";
import { readRuntimeNativeMethodMetadata, type NativeMethodMetadataContext } from "./runtime-native-method-metadata.js";
import { runtimeFunctionDefaults } from "./runtime-function-defaults.js";
import { readRuntimeDescriptorMethod } from "./runtime-descriptor-method.js";
import { lookupMroAttribute } from "./class-attributes.js";
import { getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";

/** Default exact-value lookup. Only explicitly implemented Python members are
 * exposed; host payload fields and JavaScript prototypes are never inspected.
 * Custom object policies can replace this operation in expression bindings.
 * Type descriptors, inherited object members and native introspection remain
 * separate from these instance-bound container capabilities. A formatting
 * supplier is acquired only for members that actually require that policy. */
export function runtimeNativeAttribute(receiver: RuntimeValue, name: string, values: RuntimeValues, meter: ExecutionMeter, beginCall?: ExpressionContext<RuntimeValue>["beginCall"], formatting?: FormatContext<RuntimeValue> | (() => FormatContext<RuntimeValue>), methods?: RuntimeListMethodContext & RuntimeBytesInputContext & NativeMethodMetadataContext & { readonly translation?: RuntimeStringTranslationContext; readonly buffers?: RuntimeBufferContext; readonly dictionaryKeys?: KeyOperations<RuntimeValue>; readonly attribute?: ExpressionContext<RuntimeValue>["attribute"] }): RuntimeValue {
  meter.checkpoint();
  if (receiver.kind === "function") {
    if (name === "__defaults__" || name === "__kwdefaults__") return runtimeFunctionDefaults(receiver, name, values, meter, methods?.dictionaryKeys);
    if (name === "__dict__") {
      if (methods?.dictionaryKeys === undefined) throw Error("function attribute dictionaries require a key policy");
      const attributes = receiver.value.attributes;
      if (attributes instanceof RuntimeAttributeStorage) return attributes.dictionary(methods.dictionaryKeys);
      const storage = new RuntimeAttributeStorage(values, meter);
      for (const [key, value] of attributes) storage.set(key, value);
      const dictionary = storage.dictionary(methods.dictionaryKeys);
      meter.checkpoint(); receiver.value.attributes = storage;
      return dictionary;
    }
    if (name === "__annotate__") return values.none;
    if (name === "__annotations__") {
      if (receiver.value.annotations !== undefined) return receiver.value.annotations;
      if (methods?.dictionaryKeys === undefined) throw Error("function annotation dictionaries require a key policy");
      const dictionary = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(methods.dictionaryKeys, meter, runtimeDictionaryStorage));
      meter.checkpoint(); receiver.value.annotations = dictionary; return dictionary;
    }
    if (name === "__name__") return receiver.value.name;
    if (name === "__qualname__") return receiver.value.qualifiedName;
    if (name === "__module__") return receiver.value.module;
    if (name === "__doc__") return receiver.value.doc;
    const attribute = receiver.value.attributes.get(name);
    if (attribute !== undefined) return attribute;
  }
  if (receiver.kind === "staticmethod" || receiver.kind === "classmethod") {
    if (name === "__func__" || name === "__wrapped__") return receiver.value;
    const attribute = receiver.state.attributes.get(name);
    if (attribute !== undefined) return attribute;
  }
  if (receiver.kind === "method") {
    if (name === "__func__") return receiver.value.function;
    if (name === "__self__") return receiver.value.instance;
  }
  const descriptorMethod = readRuntimeDescriptorMethod(receiver, name, values, meter, methods);
  if (descriptorMethod !== undefined) return descriptorMethod;
  const metadata = readRuntimeNativeMethodMetadata(receiver, name, values, meter, methods);
  if (metadata !== undefined) return metadata;
  if ((receiver.kind === "slice" || receiver.kind === "mappingproxy" || receiver.kind === "range" || receiver.kind === "int" || receiver.kind === "bool") && methods?.actualType !== undefined) {
    const type = methods.actualType(receiver); meter.checkpoint();
    const member = receiver.kind === "bool" ? lookupMroAttribute(type.value.mro, values.string(name), (owner, key) => owner.namespace.items.lookup(key), meter)?.value : type.value.namespace.items.lookup(values.string(name))?.value;
    if (member?.kind === "member_descriptor" || member?.kind === "getset_descriptor") return readRuntimeGetsetDescriptor(member, receiver, type, meter);
    if (member?.kind === "wrapper_descriptor" || member?.kind === "method_descriptor" || member?.kind === "classmethod_descriptor") return getRuntimeMethodDescriptor(member, receiver, type, values, meter);
  }
  if ((receiver.kind === "tuple" || receiver.kind === "dict" || receiver.kind === "dict_keys" || receiver.kind === "dict_values" || receiver.kind === "dict_items") && methods?.actualType !== undefined) {
    const type = methods.actualType(receiver); meter.checkpoint();
    const member = lookupMroAttribute(type.value.mro, values.string(name), (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
    if (name === "__hash__" && member?.kind === "none") return member;
    if (name === "mapping" && member?.kind === "getset_descriptor") return readRuntimeGetsetDescriptor(member, receiver, type, meter);
    if (member?.kind === "wrapper_descriptor" || member?.kind === "method_descriptor" || member?.kind === "classmethod_descriptor") return getRuntimeMethodDescriptor(member, receiver, type, values, meter);
  }
  if ((name === "__eq__" || name === "__ne__" || name === "__lt__" || name === "__le__" || name === "__gt__" || name === "__ge__" || name === "__hash__" || name === "__repr__" || name === "__str__" || name === "__format__"
      || ((receiver.kind === "set" || receiver.kind === "frozenset") && (name === "__len__" || name === "__iter__" || name === "__contains__"))
      || (receiver.kind === "set" && name === "__init__")
      || (receiver.kind === "list" && (name === "__len__" || name === "__iter__" || name === "__contains__" || name === "__getitem__" || name === "__setitem__" || name === "__delitem__"
        || name === "__add__" || name === "__iadd__" || name === "__mul__" || name === "__rmul__" || name === "__imul__" || name === "__init__")))
    && (receiver.kind === "list" || receiver.kind === "set" || receiver.kind === "frozenset" || receiver.kind === "method" || receiver.kind === "method-wrapper" || receiver.kind === "builtin_function_or_method")
    && methods?.actualType !== undefined) {
    const type = methods.actualType(receiver); meter.checkpoint();
    const member = lookupMroAttribute(type.value.mro, values.string(name), (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
    if (name === "__hash__" && member?.kind === "none") return member;
    if (member?.kind === "wrapper_descriptor" || ((name === "__getitem__" || name === "__contains__" || name === "__format__") && member?.kind === "method_descriptor")) return getRuntimeMethodDescriptor(member, receiver, type, values, meter);
  }
  if (receiver.kind === "str" && (name === "format" || name === "format_map")) {
    const supplied = typeof formatting === "function" ? formatting() : formatting; meter.checkpoint();
    const context = supplied ?? createRuntimeFormatContext(values, meter, { defaultRepr() { throw new UnsupportedExpressionError("attribute"); } });
    return createRuntimeBraceFormatMethod(receiver, name, values, meter, context, {
      attribute: methods?.attribute?.bind(methods) ?? ((value, key) => runtimeNativeAttribute(value, key, values, meter, beginCall, context, methods)),
      getItem: (value, key) => runtimeIndex(value, key, values, meter)
    });
  }
  const iteratorMethod = readRuntimeIteratorMethod(receiver, name, values, meter);
  if (iteratorMethod !== undefined) return iteratorMethod;
  if ((name === "__str__" || name === "__repr__") && hasNativeRepresentation(receiver)) return createRuntimeNativeRepresentationMethod(receiver, name, values, meter);
  if (name === "__format__" && (receiver.kind === "str" || receiver.kind === "int" || receiver.kind === "bool"
    || receiver.kind === "float" || receiver.kind === "complex" || hasNativeObjectFormat(receiver))) {
    const context = typeof formatting === "function" ? formatting() : formatting; meter.checkpoint();
    return createRuntimeNativeFormatMethod(receiver, values, meter, context);
  }
  if ((receiver.kind === "int" || receiver.kind === "bool") && name === "from_bytes") return createRuntimeIntegerFromBytesMethod(receiver.kind === "bool", values, meter, methods);
  if ((receiver.kind === "int" || receiver.kind === "bool") && name === "to_bytes") return createRuntimeIntegerToBytesMethod(receiver, values, meter, methods);
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
  if ((receiver.kind === "str" || receiver.kind === "bytes") && (name === "split" || name === "rsplit")) return createRuntimeSplitMethod(receiver, name, values, meter, methods?.integerIndex, methods?.buffers);
  if ((receiver.kind === "str" || receiver.kind === "bytes") && name === "expandtabs") return createRuntimeExpandtabsMethod(receiver, values, meter, methods?.integerIndex);
  if ((receiver.kind === "str" || receiver.kind === "bytes") && (name === "center" || name === "ljust" || name === "rjust" || name === "zfill")) return createRuntimePadMethod(receiver, name, values, meter, methods?.integerIndex, methods?.bytes);
  if (receiver.kind === "bytes") {
    if (name === "fromhex") return createRuntimeBytesFromhexMethod(values, meter, methods?.buffers);
    if (name === "hex") return createRuntimeBytesHexMethod(receiver, values, meter, methods?.integerIndex);
    if (name === "maketrans") return createRuntimeBytesMaketransMethod(values, meter, methods?.buffers);
    if (name === "translate") return createRuntimeBytesTranslateMethod(receiver, values, meter, methods?.buffers);
    if (name === "replace") return createRuntimeBytesReplaceMethod(receiver, values, meter, methods?.integerIndex, methods?.buffers);
    if (name === "strip" || name === "lstrip" || name === "rstrip") return createRuntimeBytesStripMethod(receiver, name, values, meter, methods?.buffers);
    if (name === "join") return createRuntimeBytesJoinMethod(receiver, values, meter, methods?.iterate, methods?.buffers);
    if (name === "removeprefix" || name === "removesuffix" || name === "partition" || name === "rpartition") return createRuntimeBytesCutMethod(receiver, name, values, meter, methods?.buffers);
    if (name === "startswith" || name === "endswith") return createRuntimeBytesAffixMethod(receiver, name, values, meter, methods?.integerIndex, methods?.buffers);
    if (name === "upper" || name === "lower" || name === "title" || name === "capitalize" || name === "swapcase") return createRuntimeBytesCaseMethod(receiver, name, values, meter);
    switch (name) {
      case "find": case "rfind": case "index": case "rindex": case "count":
        return createRuntimeBytesSearchMethod(receiver, name, values, meter, methods?.integerIndex, methods?.buffers);
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
    if (name === "translate") return createRuntimeStringTranslateMethod(receiver, values, meter, methods?.translation);
    if (name === "maketrans") return createRuntimeStringMaketransMethod(values, meter);
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
    switch (name) {
      case "append": case "extend": case "insert": case "pop": case "clear": case "reverse": case "copy": case "count": case "remove": case "index": case "__reversed__": case "sort":
        if (methods?.actualType !== undefined) {
          const type = methods.actualType(receiver); meter.checkpoint();
          const member = lookupMroAttribute(type.value.mro, values.string(name), (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
          if (member?.kind === "method_descriptor") return getRuntimeMethodDescriptor(member, receiver, type, values, meter);
        }
        return name === "sort" ? createRuntimeListSortMethod(receiver, values, meter, beginCall) : createRuntimeListMethod(receiver, name, values, meter, methods);
    }
  }
  if (receiver.kind === "dict" || receiver.kind === "mappingproxy") {
    switch (name) {
      case "fromkeys":
        if (receiver.kind === "dict") {
          if (methods?.dictionaryKeys === undefined) throw Error("dictionary fromkeys requires a key policy");
          return createDictionaryFromKeysBuiltin(values, methods.dictionaryKeys, meter);
        }
        break;
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
    if (methods?.actualType !== undefined) {
      const type = methods.actualType(receiver); meter.checkpoint();
      const member = lookupMroAttribute(type.value.mro, values.string(name), (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
      if (member?.kind === "method_descriptor" || member?.kind === "wrapper_descriptor") return getRuntimeMethodDescriptor(member, receiver, type, values, meter);
    }
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
  throw new PythonRuntimeError("AttributeError", `'${receiver.kind === "none" ? "NoneType" : receiver.kind}' object has no attribute '${name}'`);
}
