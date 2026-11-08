import { expect, expectTypeOf, it } from "vitest";
import * as sdk from "./index.js";

it("exports the async presentation factory and synchronous live core properties", async () => {
  expect(sdk.Presentation).toBeTypeOf("function");
  const pending = sdk.Presentation();
  expectTypeOf(pending).toEqualTypeOf<Promise<sdk.PresentationModel>>();
  expect(pending).toBeInstanceOf(Promise);
  const model = await pending;
  expectTypeOf(model.part).toEqualTypeOf<sdk.PartView>();
  expectTypeOf(model.part.package).toEqualTypeOf<sdk.PackageView>();
  expectTypeOf(model.element).toEqualTypeOf<sdk.XmlElementView>();
  expectTypeOf(model.part.rels).toEqualTypeOf<readonly sdk.PartRelationship[]>();
  expect(model.element.tag.localName).toBe("presentation");
  expect(model.core_properties).toBeInstanceOf(sdk.CoreProperties);
  expectTypeOf(model.core_properties).toEqualTypeOf<sdk.CoreProperties>();
  model.core_properties.title = "Estuary survey";
  const bytes = model.save();
  expectTypeOf(bytes).toEqualTypeOf<Promise<Uint8Array>>();
  expect((await sdk.Presentation(await bytes)).core_properties.title).toBe("Estuary survey");
});
