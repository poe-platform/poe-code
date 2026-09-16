import { expectTypeOf, it } from "vitest";
import type { BinaryInput, ByteSource, OfficeResult, OperationRequest } from "./index.js";
import { readBinary } from "./bytes.js";

it("retains asynchronous byte and discriminated result contracts", () => {
  expectTypeOf<ReturnType<ByteSource["read"]>>().toEqualTypeOf<Promise<Uint8Array | null>>();
  expectTypeOf<ReturnType<typeof readBinary>>().toEqualTypeOf<Promise<Uint8Array>>();
  type Comparison = OfficeResult<{ readonly equal: boolean }, "diff">;
  const different: Comparison = {
    version: 1,
    operation: "diff",
    ok: true,
    data: { equal: false },
    warnings: [],
    errors: [],
    affected: 0,
    locations: []
  };
  expectTypeOf(different.data.equal).toEqualTypeOf<boolean>();
  expectTypeOf<Extract<Comparison, { ok: false }>["data"]>().toEqualTypeOf<null>();
  expectTypeOf<Extract<Comparison, { ok: false }>["affected"]>().toEqualTypeOf<0>();
  expectTypeOf<Extract<Comparison, { ok: false }>["errors"]>().not.toEqualTypeOf<readonly []>();
  expectTypeOf<string>().not.toExtend<BinaryInput>();
  type Request = OperationRequest<"text.replace", { find: string; with: string }, { all: true }>;
  expectTypeOf<Request["operation"]>().toEqualTypeOf<"text.replace">();
  expectTypeOf<Request["arguments"]>().toEqualTypeOf<{ find: string; with: string }>();
});
