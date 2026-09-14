import type { ExecutionMeter } from "./execution-budget.js";
import { callRuntimeIntegerToBytes } from "./runtime-integer-to-bytes-method.js";
import { runtimeIntegerFromBytes } from "./runtime-integer-from-bytes-method.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Byte conversion keeps native parsing separate from bound-class construction. */
export function installRuntimeIntegerByteDescriptors(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 192);
  owner.value.namespace.items.set(values.string("to_bytes"), values.methodDescriptor({textSignature: "($self, /, length=1, byteorder='big', *, signed=False)",  owner, name: "to_bytes",
    doc: "Return an array of bytes representing an integer.\n\n  length\n    Length of bytes object to use.  An OverflowError is raised if\n    the integer is not representable with the given number of bytes.\n    Default is length 1.\n  byteorder\n    The byte order used to represent the integer.  If byteorder is\n    'big', the most significant byte is at the beginning of the byte\n    array.  If byteorder is 'little', the most significant byte is at\n    the end of the byte array.  To request the native byte order of\n    the host system, use sys.byteorder as the byte order value.\n    Default is to use 'big'.\n  signed\n    Determines whether two's complement is used to represent the\n    integer.  If signed is False and a negative integer is given,\n    an OverflowError is raised.",
    accepts: receiver => runtimeIntegerPayload(receiver) !== undefined,
    invoke(receiver, positional, keywords, meter, invocation) {
      return callRuntimeIntegerToBytes(receiver, positional, keywords, values, meter, invocation);
    }
  }));
  owner.value.namespace.items.set(values.string("from_bytes"), values.classMethodDescriptor({textSignature: "($type, /, bytes, byteorder='big', *, signed=False)",  owner, name: "from_bytes",
    doc: "Return the integer represented by the given array of bytes.\n\n  bytes\n    Holds the array of bytes to convert.  The argument must either\n    support the buffer protocol or be an iterable object producing\n    bytes.  Bytes and bytearray are examples of built-in objects that\n    support the buffer protocol.\n  byteorder\n    The byte order used to represent the integer.  If byteorder is\n    'big', the most significant byte is at the beginning of the byte\n    array.  If byteorder is 'little', the most significant byte is at\n    the end of the byte array.  To request the native byte order of\n    the host system, use sys.byteorder as the byte order value.\n    Default is to use 'big'.\n  signed\n    Indicates whether two's complement is used to represent the\n    integer.",
    accepts(receiver, meter) {
      if (receiver.kind !== "type") return false;
      for (const ancestor of receiver.value.mro) { meter.checkpoint(); if (ancestor === owner.value) return true; }
      return false;
    },
    invoke(receiver, positional, keywords, meter, invocation) {
      const result = values.integer(runtimeIntegerFromBytes(positional, keywords, values, meter, {
        integerIndex: invocation?.integerIndex, truth: invocation?.truth,
        iterate: source => runtimeIterate(source, values, meter, invocation?.iteration),
        bytes: invocation?.bytes ?? {
          lookupBytes(source) {
            const method = invocation?.lookupSpecial?.(source, "__bytes__"); meter.checkpoint();
            return method === undefined ? undefined : () => invocation!.call(method, []);
          },
          byteString: source => source.kind === "bytes" ? source.value : undefined,
          typeName: source => invocation?.typeName?.(source) ?? (source.kind === "none" ? "NoneType" : source.kind === "not-implemented" ? "NotImplementedType" : source.kind)
        }
      }));
      if (receiver === owner) return result;
      if (invocation === undefined) throw Error("integer subclass byte construction requires an invocation policy");
      return invocation.call(receiver, [result]);
    }
  }));
}
