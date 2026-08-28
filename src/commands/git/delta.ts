import type { GitObject } from "./codec.js";
import type { Session } from "./io.js";
import { GIT_LIMITS, demand } from "./limits.js";

export async function applyDelta(session: Session, base: GitObject, program: Uint8Array, expectedOid: string): Promise<GitObject> {
  demand(program.length >= 4 && program.length <= GIT_LIMITS.maxObjectBytes, "Git delta program size refused");
  let cursor = 0;
  const byte = (): number => { demand(cursor < program.length, "truncated Git delta"); return program[cursor++]!; };
  const variable = async (): Promise<number> => {
    let value = 0, factor = 1;
    for (;;) {
      await session.step();
      const part = byte();
      value += (part & 127) * factor;
      demand(Number.isSafeInteger(value) && value <= GIT_LIMITS.maxObjectBytes, "Git delta size exceeded");
      if (part < 128) return value;
      factor *= 128;
      demand(Number.isSafeInteger(factor), "Git delta integer overflow");
    }
  };
  demand(await variable() === base.bytes.length, "Git delta base size mismatch");
  const size = await variable();
  const body = session.allocate(size);
  let produced = 0, success = false;
  try {
    while (cursor < program.length) {
      await session.step();
      const opcode = byte();
      demand(opcode !== 0, "invalid Git delta opcode");
      let source: Uint8Array;
      if (opcode >= 128) {
        let offset = 0, length = 0;
        for (let index = 0; index < 4; index++) if (opcode & (1 << index)) offset += byte() * 2 ** (index * 8);
        for (let index = 0; index < 3; index++) if (opcode & (1 << (index + 4))) length += byte() * 2 ** (index * 8);
        if (length === 0) length = 65536;
        demand(offset <= base.bytes.length && length <= base.bytes.length - offset, "Git delta copy outside base");
        source = base.bytes.subarray(offset, offset + length);
      } else {
        demand(opcode <= program.length - cursor, "truncated Git delta literal");
        source = program.subarray(cursor, cursor + opcode);
        cursor += opcode;
      }
      demand(source.length <= size - produced, "Git delta result overflow");
      session.charge("maxInflatedBytes", source.length);
      await session.copyInto(body, source, produced);
      produced += source.length;
    }
    demand(produced === size, "truncated Git delta result");
    demand(await session.hash(body, base.type) === expectedOid, "Git delta object hash mismatch");
    success = true;
    return { type: base.type, bytes: body };
  } finally { if (!success) session.release(body); }
}
