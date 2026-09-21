import { expect, it } from "vitest";
import { resourceUri } from "../resource-uri.js";
import { resourceBasename } from "./names.js";

it("matches GIO filename URI escaping for reserved and Unicode path characters", () => {
  expect(resourceUri("/work/a !@:$&()+,;=.csv", "/")).toBe("file:///work/a%20!@:$&()+,%3B=.csv");
  expect(resourceUri("café#%.csv", "/work")).toBe("file:///work/caf%C3%A9%23%25.csv");
  expect(resourceUri("a[brackets].csv", "/work")).toBe("file:///work/a%5Bbrackets%5D.csv");
  expect(resourceBasename("file:///work/caf%C3%A9.csv", "/")).toBe("café.csv");
  expect(resourceBasename("file:///work/a\\x.csv", "/")).toBe("a\\x.csv");
});
