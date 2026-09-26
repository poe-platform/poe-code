import assert from "node:assert/strict";
import { test } from "node:test";
import { getItemTemplate, listItemTemplates } from "./templates.js";

test("Login matches the official published JSON schema", () => {
  assert.deepEqual(getItemTemplate("Login"), {
    title: "", category: "LOGIN", fields: [
      { id: "username", type: "STRING", purpose: "USERNAME", label: "username", value: "" },
      { id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", password_details: { strength: "TERRIBLE" }, value: "" },
      { id: "notesPlain", type: "STRING", purpose: "NOTES", label: "notesPlain", value: "" }
    ]
  });
  assert.deepEqual(listItemTemplates(), ["Login"]);
  assert.throws(() => getItemTemplate("Server"), { message: "Item template schema is unavailable" });
});

test("supplied schemas resolve names, IDs and categories with independent results", () => {
  const templates = [{ id: "custom", name: "Custom Server", title: "", category: "SERVER", fields: [{ id: "host", type: "STRING", value: "localhost" }] }];
  for (const selector of ["custom", "Custom Server", "server"]) {
    const template = getItemTemplate(selector, templates);
    assert.equal(template.category, "SERVER");
    assert.equal(template.fields[0]?.value, "localhost");
    template.fields[0]!.value = "changed";
  }
  assert.deepEqual(listItemTemplates(templates), ["Login", "Custom Server"]);
  assert.equal(templates[0]?.fields[0]?.value, "localhost");
  assert.throws(() => getItemTemplate("Broken", [{ id: "Broken", category: "SERVER" }]));
  assert.throws(() => getItemTemplate("SERVER", [...templates, { ...templates[0]!, id: "second" }]));
});
