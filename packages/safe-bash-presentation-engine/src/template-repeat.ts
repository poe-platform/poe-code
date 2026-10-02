import type { BinaryInput, Location } from "./contracts.js";
import { readBinary } from "./bytes.js";
import { OfficeError } from "./errors.js";
import { readSelectionIndex, type SelectionContext } from "./selectors.js";
import { duplicateSlides } from "./slide-copy.js";
import { removeSlides } from "./slide-removal.js";
import {
  applyTemplateBindings,
  validateTemplateBindings,
  type TemplateBinding
} from "./template-bindings.js";

export interface TemplateRepeat {
  readonly kind: "repeat";
  readonly slides: readonly number[];
  readonly records: readonly (readonly TemplateBinding[])[];
  readonly mediaPolicy: "shared-media" | "isolated-instance";
}
function invalid(): never {
  throw new OfficeError(
    "invalid-value",
    "Repeat requires closed stored records, distinct prototype positions and an explicit media policy.",
    "usage"
  );
}
function array(value: unknown): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    invalid();
  for (let i = 0; i < value.length; i++)
    if (!("value" in (Object.getOwnPropertyDescriptor(value, String(i)) ?? {}))) invalid();
}
export function validateTemplateRepeat(value: unknown): asserts value is TemplateRepeat {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalid();
  const keys = ["kind", "slides", "records", "mediaPolicy"];
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        !keys.includes(key) ||
        !("value" in Object.getOwnPropertyDescriptor(value, key)!)
    )
  )
    invalid();
  const repeat = value as TemplateRepeat;
  if (
    repeat.kind !== "repeat" ||
    !["shared-media", "isolated-instance"].includes(repeat.mediaPolicy)
  )
    invalid();
  array(repeat.slides);
  array(repeat.records);
  if (
    !repeat.slides.length ||
    repeat.slides.length > 1000 ||
    new Set(repeat.slides).size !== repeat.slides.length ||
    repeat.slides.some((slide) => !Number.isSafeInteger(slide) || slide < 1)
  )
    invalid();
  if (repeat.records.length > 1000)
    throw new OfficeError("resource-limit", "Repeat record limit exceeded.", "admit");
  let count = 0;
  for (const record of repeat.records) {
    validateTemplateBindings(record);
    count += record.length;
    if (count > 1000)
      throw new OfficeError("resource-limit", "Repeat binding limit exceeded.", "admit");
    if (record.some((binding) => !repeat.slides.includes(binding.slide))) invalid();
  }
}
export async function applyTemplateRepeat(
  input: BinaryInput,
  repeat: TemplateRepeat,
  context: SelectionContext
): Promise<{
  readonly bytes: Uint8Array;
  readonly affected: number;
  readonly locations: readonly Location[];
}> {
  validateTemplateRepeat(repeat);
  if (repeat.slides.length * repeat.records.length > context.relationshipLimits.maxParts)
    throw new OfficeError("resource-limit", "Repeated slide limit exceeded.", "admit");
  const slides = [...repeat.slides],
    policy = repeat.mediaPolicy;
  let payloadBytes = 0;
  const size = (value: string) => {
    for (const character of value) {
      const point = character.codePointAt(0)!;
      payloadBytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
  };
  for (const record of repeat.records)
    for (const binding of record) {
      if (binding.kind === "image") payloadBytes += binding.image.bytes.length;
      else if (binding.kind === "table")
        for (const row of binding.table)
          for (const cell of row) {
            size(cell);
            payloadBytes++;
          }
      else size(binding.text);
      if (payloadBytes > context.limits.maxBytes)
        throw new OfficeError(
          "resource-limit",
          "Repeat payload exceeds the aggregate byte budget.",
          "admit"
        );
    }
  const records = repeat.records.map((record) =>
    record.map((binding) =>
      binding.kind === "image"
        ? { ...binding, image: { ...binding.image, bytes: [...binding.image.bytes] } }
        : binding.kind === "table"
          ? { ...binding, table: binding.table.map((row) => [...row]) }
          : { ...binding }
    )
  );
  const source = await readBinary(input, context);
  const index = await readSelectionIndex(source, context);
  const prototypes = slides.map((position) => {
    const slide = index.slides[position - 1];
    if (!slide)
      throw new OfficeError("missing-selection", "A prototype slide does not exist.", "select");
    return slide;
  });
  const position = Math.min(...slides);
  // Validate each record against the original template before constructing instances.
  for (const record of records) {
    context.signal?.throwIfAborted();
    await applyTemplateBindings(source, record, context, slides);
  }
  let bytes = source;
  const cloneParts: string[] = [];
  const bindingObjects: { owner: string; objectId: string }[] = [];
  let affected = prototypes.length;
  for (const [recordIndex, record] of records.entries()) {
    const insertAt = position + recordIndex * slides.length;
    bytes = await duplicateSlides(
      bytes,
      {
        selection: prototypes.map((slide) => ({ kind: "slide", id: slide.id })),
        position: insertAt,
        mediaPolicy: policy
      },
      context
    );
    const current = await readSelectionIndex(bytes, context);
    cloneParts.push(
      ...current.slides.slice(insertAt - 1, insertAt - 1 + slides.length).map((slide) => slide.part)
    );
    const bound = await applyTemplateBindings(
      bytes,
      record.map((binding) => ({ ...binding, slide: insertAt + slides.indexOf(binding.slide) })),
      context
    );
    bytes = bound.bytes;
    affected += slides.length + bound.affected;
    bindingObjects.push(
      ...bound.locations.map((location) => ({ owner: location.owner, objectId: location.objectId }))
    );
  }
  bytes = await removeSlides(
    bytes,
    { selection: prototypes.map((slide) => ({ kind: "slide", id: slide.id })) },
    context
  );
  const final = await readSelectionIndex(bytes, context);
  const locations = records.length
    ? final.slides.filter((slide) => cloneParts.includes(slide.part)).map((slide) => slide.location)
    : prototypes.map((slide) => slide.location);
  for (const target of bindingObjects) {
    const object = final.objects.find(
      (object) => object.location.owner === target.owner && object.id === target.objectId
    );
    if (
      object &&
      !locations.some(
        (location) => location.owner === object.location.owner && location.objectId === object.id
      )
    )
      locations.push(object.location);
  }
  return { bytes, affected, locations };
}
