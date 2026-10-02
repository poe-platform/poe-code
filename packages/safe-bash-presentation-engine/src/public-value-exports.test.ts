import { expect, it } from "vitest";
import * as sdk from "./index.js";

it("exposes documented value enums and neutral error constructors", () => {
  expect(sdk.MSO_LANGUAGE_ID.POLISH).toBe(1045);
  expect(sdk.MSO_THEME_COLOR).toBe(sdk.MSO_THEME_COLOR_INDEX);
  expect(sdk.MSO_COLOR_TYPE.RGB).toBe(1);
  expect(sdk.XL_LABEL_POSITION).toBe(sdk.XL_DATA_LABEL_POSITION);
  expect(sdk.XL_CHART_TYPE.PIE).toBe(5);
  expect(sdk.PP_MEDIA_TYPE.MOVIE).toBe(3);
  expect(sdk.MSO).toBe(sdk.MSO_SHAPE_TYPE);
  expect(new sdk.IndexError()).toBeInstanceOf(sdk.OfficeError);
  expect(new sdk.KeyError()).toBeInstanceOf(sdk.OfficeError);
  expect(new sdk.ValueError()).toBeInstanceOf(sdk.OfficeError);
  expect(new sdk.TypeError()).toBeInstanceOf(sdk.OfficeError);
  expect(new sdk.PropertyAccessError()).toBeInstanceOf(sdk.OfficeError);
});
