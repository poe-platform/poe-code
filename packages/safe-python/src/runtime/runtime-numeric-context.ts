import type { ExecutionMeter } from "./execution-budget.js";
import { lookupRuntimeSpecialMethod, runtimeActualType, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import { resolveRuntimeTypeAttribute } from "./runtime-type-layout.js";
import type { MultiplicationContext } from "./runtime-multiplication.js";
import { runtimeNumericMethods, usesRuntimeGuestNumericSlots } from "./runtime-numeric-slots.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimePowerSlot } from "./runtime-power.js";
import { runtimeDivmod } from "./runtime-divmod.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import { runtimeTuplePayload } from "./runtime-tuple-payload.js";
import { isRuntimeSet, type BuiltinInvocationContext, type RuntimeValue, type RuntimeValues, type TypeValue } from "./runtime-values.js";

/** Prepare one pair, keeping method lookup live until dispatch. Native pairs
 * retain kernel fast paths. Canonical native types participate in subtype
 * reflection priority; other native numeric slots precede guest reflection.
 * sequence concat/repeat remain caller-owned fallbacks. Native-subclass storage and
 * metaclass attribute overrides remain separate object-layer responsibilities. */
export function createRuntimeNumericContext(operator: string, left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, special: RuntimeSpecialMethodContext, invocation: BuiltinInvocationContext, modulus: RuntimeValue = values.none): MultiplicationContext | undefined {
  meter.checkpoint();
  const leftGuest = usesRuntimeGuestNumericSlots(left), rightGuest = usesRuntimeGuestNumericSlots(right);
  if (!leftGuest && !rightGuest) return undefined;
  const names = runtimeNumericMethods.get(operator);
  if (names === undefined) throw Error(`unsupported numeric operator: ${operator}`);
  const { forward: forwardName, reflected: reflectedName } = names;
  const leftType = leftGuest || isRuntimeSet(left) ? runtimeActualType(left, special, meter) : undefined; meter.checkpoint();
  const rightType = rightGuest || isRuntimeSet(right) ? runtimeActualType(right, special, meter) : undefined; meter.checkpoint();
  let relation: "same" | "right-subtype" | "other" = "other";
  if (leftType !== undefined && rightType !== undefined) {
    if (leftType === rightType) relation = "same";
    else for (const ancestor of rightType.value.mro) {
      meter.checkpoint();
      if (ancestor === leftType.value) { relation = "right-subtype"; break; }
    }
  }
  meter.checkpoint(0, 512);
  const sequenceFallbacks = { left: !leftGuest || (runtimeListPayload(left) === undefined && runtimeTuplePayload(left) === undefined), right: !rightGuest || (runtimeListPayload(right) === undefined && runtimeTuplePayload(right) === undefined) };
  const call = (receiver: RuntimeValue, other: RuntimeValue, type: TypeValue | undefined, name: string): RuntimeValue => {
    if (type === undefined) {
      if (operator === "divmod()") return runtimeDivmod(left, right, values, meter);
      if (operator === "**") return runtimePowerSlot(receiver, left, right, modulus, values, meter);
      if (operator === "+" || operator === "*") return values.notImplemented;
      if (operator === "|" && receiver.kind === "mappingproxy") {
        if (invocation.binary === undefined) throw Error("mapping proxy union requires a binary policy");
        return name === forwardName ? invocation.binary(operator, receiver.value, other) : invocation.binary(operator, other, receiver.value);
      }
      return runtimeBinary(operator, left, right, values, meter, invocation.iteration, invocation);
    }
    const method = lookupRuntimeSpecialMethod(receiver, type, values.string(name), special, values, meter);
    meter.checkpoint();
    if (runtimeListPayload(receiver) !== undefined || runtimeTuplePayload(receiver) !== undefined) {
      let nativeSequence = method?.kind === "method-wrapper" && method.value.descriptor.value.sequenceOperator === operator && method.value.descriptor.value.name === name;
      if (nativeSequence) {
        // Forward/reflected overrides share the native numeric slot. Once one
        // side is customized, the inherited partner is called as a descriptor.
        const oppositeName = name === forwardName ? reflectedName : forwardName;
        const opposite = resolveRuntimeTypeAttribute(type.value, values.string(oppositeName), special, values, meter)?.attribute.value;
        nativeSequence = opposite === undefined || (opposite.kind === "wrapper_descriptor" && opposite.value.sequenceOperator === operator && opposite.value.name === oppositeName);
      }
      sequenceFallbacks[name === forwardName ? "left" : "right"] = nativeSequence;
      if (nativeSequence) return values.notImplemented;
    }
    if (method === undefined) return values.notImplemented;
    const ternary = operator === "**" && modulus.kind !== "none";
    meter.checkpoint(0, ternary ? 24 : 16);
    const result = invocation.call(method, ternary ? [other, modulus] : [other]); meter.checkpoint(); return result;
  };
  const classMethod = (type: TypeValue): RuntimeValue | undefined => {
    const found = resolveRuntimeTypeAttribute(type.value, values.string(reflectedName), special, values, meter);
    if (found === undefined) return undefined;
    const attribute = found.attribute;
    const result = attribute.slots?.get === undefined ? attribute.value : attribute.slots.get(null, type);
    meter.checkpoint(); return result;
  };
  return {
    sequenceFallbacks,
    leftHasSequenceTable: leftType?.value.hasSequenceTable,
    numeric: {
      relation, notImplemented: values.notImplemented,
      forward: () => call(left, right, leftType, forwardName),
      reflected: () => call(right, left, rightType, reflectedName),
      reflectedIsOverridden() {
        const b = classMethod(rightType!);
        if (b === undefined) return false;
        const a = classMethod(leftType!);
        if (a === undefined) return true;
        if (a === b) return false;
        if (invocation.compareTruth === undefined) throw Error("numeric override comparison requires a comparison policy");
        const result = invocation.compareTruth("!=", a, b); meter.checkpoint(); return result;
      }
    },
    get integerIndex() { return invocation.integerIndex; },
    typeName(value) {
      if (usesRuntimeGuestNumericSlots(value)) { const type = runtimeActualType(value, special, meter); meter.checkpoint(); return type.value.name; }
      return value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
    }
  };
}
