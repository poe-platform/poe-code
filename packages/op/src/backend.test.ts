import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import type { OpBackendRequest, OpDocument, OpField, OpItem } from "./types.js";
import type { OpAdminContext } from "./admin.js";

const context = { signal: new AbortController().signal };
const request = (resource: string, action: string, args: readonly string[] = [], input?: unknown, flags: OpBackendRequest["flags"] = {}): OpBackendRequest => ({ resource, action, args, flags, input });

test("copy edit and move discard supplied derived references while get derives current references and preserves values", async () => {
  const value = "op://user-authored/value/must-stay";
  const original = { id: "source", title: "Source", vault: "vault", fields: [{ id: "custom", label: "Payload", type: "STRING", value, reference: "op://stale/source/custom" }] };
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }, { id: "destination", name: "Destination" }], items: [original] });
  const copied = await backend.execute(request("item", "create", [], original), context) as OpItem;
  const edited = await backend.execute(request("item", "edit", ["source"], { fields: original.fields }), context) as OpItem;
  const fetchedEdited = await backend.execute(request("item", "get", ["source"]), context) as OpItem;
  assert.equal(fetchedEdited.fields?.[0]?.reference, "op://vault/source/custom");
  assert.equal(fetchedEdited.fields?.[0]?.value, value);
  const moved = await backend.execute(request("item", "move", ["source"], undefined, { "destination-vault": "destination" }), context) as OpItem;
  for (const item of [copied, edited, moved]) {
    assert.equal(item.fields?.[0]?.reference, undefined);
    assert.equal(item.fields?.[0]?.value, value);
    assert.equal(backend.snapshot().items?.find(stored => stored.id === item.id)?.fields?.[0]?.reference, undefined);
  }
  for (const item of [copied, moved]) {
    const fetched = await backend.execute(request("item", "get", [item.id]), context) as OpItem;
    assert.equal(fetched.fields?.[0]?.reference, `op://${item.vault.id}/${item.id}/${item.fields![0]!.id}`);
    assert.equal(fetched.fields?.[0]?.value, value);
  }
  assert.equal(original.fields[0]?.reference, "op://stale/source/custom");
  const seeded = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }, { id: "destination", name: "Destination" }], items: [original] });
  const directlyMoved = await seeded.execute(request("item", "move", ["source"], undefined, { "destination-vault": "destination" }), context) as OpItem;
  assert.equal(directlyMoved.fields?.[0]?.reference, undefined);
  assert.equal(seeded.snapshot().items?.find(item => item.id === directlyMoved.id)?.fields?.[0]?.reference, undefined);
});

test("explicit destination account and vault override copied associations for single and bulk templates across stores", async () => {
  for (const bulk of [false, true]) {
    const source = createObjectBackend({ accounts: [{ id: "a" }], vaults: [{ id: "va", name: "Source", account: "a" }], items: [{ id: "original", title: "Original", account: "a", vault: "va", category: "LOGIN", fields: [{ id: "password", type: "CONCEALED", value: "synthetic" }] }] });
    const destination = createObjectBackend({ accounts: [{ id: "b", shorthand: "work" }], vaults: [{ id: "vb", name: "Destination", account: "b" }], items: [{ id: "untouched", title: "Untouched", vault: "vb" }] });
    const sourceBefore = source.snapshot();
    const destinationBefore = destination.snapshot();
    const template = await source.execute(request("item", "get", ["original"], undefined, { account: "a" }), context) as OpItem;
    const input = bulk ? [template, template] : template;
    const originalInput = structuredClone(input);
    const flags = { account: "work", vault: "Destination" };
    const preview = await destination.execute(request("item", "create", ["password=copy"], input, { ...flags, "dry-run": true }), context);
    assert.equal(Array.isArray(preview), bulk);
    assert.deepEqual(destination.snapshot(), destinationBefore);
    const result = await destination.execute(request("item", "create", ["password=copy"], input, flags), context);
    const copies = (bulk ? result : [result]) as OpItem[];
    assert.equal(copies.length, bulk ? 2 : 1);
    for (const copy of copies) {
      assert.notEqual(copy.id, "original");
      assert.equal(copy.account, "b");
      assert.equal(copy.vault.id, "vb");
      assert.equal(copy.fields?.find(field => field.id === "password")?.value, "copy");
    }
    assert.deepEqual(destination.snapshot().items?.[0], destinationBefore.items?.[0]);
    assert.deepEqual(source.snapshot(), sourceBefore);
    assert.deepEqual(input, originalInput);
  }
});

test("cross-account copies require both explicit destination selectors and cannot override account admission", async () => {
  const backend = createObjectBackend({ accounts: [{ id: "a" }, { id: "b" }], vaults: [{ id: "va", name: "Source", account: "a" }, { id: "vb", name: "Destination", account: "b" }], items: [{ id: "source", title: "Source", account: "a", vault: "va" }] });
  const template = backend.snapshot().items![0]!;
  const before = backend.snapshot();
  const invalidDestinations: OpBackendRequest["flags"][] = [{ account: "b" }, { vault: "vb" }, { account: "b", vault: "va" }, { account: "missing", vault: "vb" }];
  for (const input of [template, [template]]) {
    for (const flags of invalidDestinations) {
      await assert.rejects(backend.execute(request("item", "create", [], input, flags), context));
      assert.deepEqual(backend.snapshot(), before);
    }
  }
  const managed = createObjectBackend({ ...before, authentication: { mode: "managed" }, clock: { now: () => 1 }, resources: { session: [{ id: "session", mode: "manual", token: "source-only", account: "a", issuedAt: 0, lastActivityAt: 0 }] } });
  const managedBefore = managed.snapshot();
  await assert.rejects(managed.execute(request("item", "create", [], [template], { account: "b", vault: "vb", session: "source-only" }), context));
  assert.deepEqual(managed.snapshot(), managedBefore);
  await assert.rejects(backend.execute(request("item", "create", [], [template, { title: "Invalid", fields: "invalid" }], { account: "b", vault: "vb" }), context));
  assert.deepEqual(backend.snapshot(), before);
});

test("copy hooks receive only destination associations and cannot publish foreign writes", async () => {
  const observed: OpBackendRequest[] = [];
  const backend = createObjectBackend({ accounts: [{ id: "a" }, { id: "b" }], vaults: [{ id: "va", name: "Source", account: "a" }, { id: "vb", name: "Destination", account: "b" }], items: [{ id: "source", title: "Source", account: "a", vault: "va" }], adminHooks: {
    "item create": async request => {
      observed.push(request);
      const input = request.input as OpItem;
      return { resources: { item: [{ ...input, id: "forbidden", account: "a", vault: "va" }] } };
    }
  } });
  const before = backend.snapshot();
  await assert.rejects(backend.execute(request("item", "create", [], before.items![0], { account: "b", vault: "vb" }), context));
  assert.equal(observed.length, 1);
  assert.equal((observed[0]?.input as OpItem).account, "b");
  assert.equal((observed[0]?.input as OpItem).vault, "vb");
  assert.deepEqual(backend.snapshot(), before);
});

test("item get without positional selectors consumes provided stdin through the validated batch path only", async () => {
  const backend = createObjectBackend({
    accounts: [{ id: "a" }, { id: "b" }], vaults: [{ id: "va", name: "Private", account: "a" }, { id: "vb", name: "Foreign", account: "b" }],
    items: [{ id: "first", title: "First", vault: "va" }, { id: "second", title: "Second", vault: "va" }, { id: "foreign", title: "Foreign", vault: "vb" }]
  });
  const before = backend.snapshot();
  for (const input of ["Second\nFirst", [{ id: "second" }, { id: "first" }], '{"id":"second"}{"id":"first"}']) {
    const value = await backend.execute(request("item", "get", [], input, { account: "a" }), context) as OpItem[];
    assert.deepEqual(value.map(item => item.id), ["second", "first"]);
  }
  for (const input of [undefined, "", "first\nforeign", "first\nmissing", '{"id":"first"}{']) {
    await assert.rejects(backend.execute(request("item", "get", [], input, { account: "a" }), context));
  }
  await assert.rejects(backend.execute(request("vault", "get", [], "va", { account: "a" }), context));
  await assert.rejects(backend.execute(request("item", "delete", [], "first", { account: "a" }), context));
  assert.deepEqual(backend.snapshot(), before);
});

test("item get derives fresh field references before single, batch and field projections without persisting them", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [{ id: "item", title: "Login", vault: "vault", fields: [{ id: "password", label: "password", type: "CONCEALED", value: "synthetic", reference: "op://wrong/item/password" }, { id: "custom", label: "Custom", value: "value", section: { id: "section" } }], sections: [{ id: "section", label: "Section" }] }] });
  const before = backend.snapshot();
  const item = await backend.execute(request("item", "get", ["item"]), context) as OpItem;
  assert.equal(item.fields?.[0]?.reference, "op://vault/item/password");
  assert.equal(item.fields?.[1]?.reference, "op://vault/item/section/custom");
  for (const args of [["item"], ["-"]]) {
    const projected = await backend.execute(request("item", "get", args, args[0] === "-" ? ["item"] : undefined, { fields: "password" }), context) as OpField[];
    assert.equal(projected[0]?.reference, "op://vault/item/password");
  }
  const batch = await backend.execute(request("item", "get", ["-"], ["item"]), context) as OpItem[];
  assert.equal(batch[0]?.fields?.[1]?.reference, "op://vault/item/section/custom");
  assert.deepEqual(backend.snapshot(), before);
  const destination = await backend.execute(request("vault", "create", ["Destination"]), context) as { id: string };
  const moved = await backend.execute(request("item", "move", ["item"], undefined, { "destination-vault": destination.id }), context) as OpItem;
  const fetched = await backend.execute(request("item", "get", [moved.id]), context) as OpItem;
  const reference = fetched.fields?.[1]?.reference;
  assert.equal(reference, `op://${destination.id}/${moved.id}/section/custom`);
  assert.equal(await backend.execute(request("secret", "read", [reference!]), context), "value");
});

test("bulk creation validates every account boundary before invoking hooks", async () => {
  let calls = 0;
  const backend = createObjectBackend({
    accounts: [{ id: "a" }, { id: "b" }], vaults: [{ id: "va", name: "Source", account: "a" }, { id: "vb", name: "Foreign", account: "b" }],
    adminHooks: { "item create": async () => { calls++; return { value: [] }; } }
  });
  const before = backend.snapshot();
  for (const foreign of [{ account: "b", vault: "va" }, { vault: "vb" }]) {
    await assert.rejects(backend.execute(request("item", "create", [], [{ title: "First", vault: "va" }, foreign], { account: "a" }), context));
    assert.equal(calls, 0);
    assert.deepEqual(backend.snapshot(), before);
  }
});

test("bulk generation cancellation publishes no items and does not alias caller input", async () => {
  const controller = new AbortController();
  let calls = 0;
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], ssh: {
    async generate() {
      if (++calls === 2) controller.abort(new Error("Cancelled bulk generation"));
      return { category: "SSH_KEY", fields: [{ id: "private_key", type: "SSHKEY", value: "synthetic" }] };
    },
    transform(source) { return source; }
  } });
  const before = backend.snapshot();
  const input = [{ title: "First" }, { title: "Second" }];
  await assert.rejects(backend.execute(request("item", "create", [], input, { "ssh-generate-key": true }), { signal: controller.signal }), { message: "Cancelled bulk generation" });
  assert.equal(calls, 2);
  assert.deepEqual(backend.snapshot(), before);
  assert.deepEqual(input, [{ title: "First" }, { title: "Second" }]);
});

test("duplicating a single item removes source lifecycle metadata without changing the source", async () => {
  const original = { id: "original", title: "Original", vault: "vault", version: 7, created_at: "old", updated_at: "old", last_edited_by: "old-user" };
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [original] });
  const copy = await backend.execute(request("item", "create", [], original), context) as OpItem;
  assert.notEqual(copy.id, original.id);
  for (const key of ["version", "created_at", "updated_at", "last_edited_by"]) assert.equal(Object.hasOwn(copy, key), false);
  assert.equal(backend.snapshot().items?.[0]?.version, 7);
  assert.equal(original.id, "original");
});

test("copy assignments resolve source custom field IDs before fresh identity allocation", async () => {
  const original = { id: "original", title: "Original", vault: "vault", fields: [{ id: "custom-id", label: "Custom", type: "STRING", value: "old" }] };
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [original] });
  const copy = await backend.execute(request("item", "create", ["custom-id=new"], original), context) as OpItem;
  assert.equal(copy.fields?.length, 1);
  assert.equal(copy.fields?.[0]?.value, "new");
  assert.notEqual(copy.fields?.[0]?.id, "custom-id");
  const sectioned = await backend.execute(request("item", "create", ["New.extra[text]=value"], original), context) as OpItem;
  const section = sectioned.sections?.find(value => value.label === "New");
  assert.ok(section?.id);
  assert.equal(sectioned.fields?.find(field => field.label === "extra")?.section?.id, section.id);
});

test("generated IDs skip uppercase field, section and file identifiers", async () => {
  const occupied = ["1", "2", "3"].map(value => value.padStart(26, "A"));
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [{ id: "item", title: "Seed", vault: "vault", fields: [{ id: occupied[0]!, value: "secret" }], sections: [{ id: occupied[1]!, label: "Section" }], files: [{ id: occupied[2]!, name: "file.bin", content: new Uint8Array([1]) }] }] });
  const created = await backend.execute(request("vault", "create", ["New"]), context) as { id: string };
  assert.equal(created.id, "4".padStart(26, "a"));
  assert.ok(occupied.every(id => id.toLowerCase() !== created.id.toLowerCase()));
});

test("attachments get IDs and canonical sections shared with fields on create and edit", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "private", name: "Private" }] });
  const input = { title: "Files", files: [{ name: "key.bin", section: { label: "Docs" }, content: new Uint8Array([0, 255]) }, { name: "other.bin", section: { label: "Docs" }, content: new Uint8Array([1]) }] };
  const item = await backend.execute(request("item", "create", ["Docs.note[text]=note"], input), context) as OpItem;
  assert.equal(item.sections?.length, 1);
  assert.ok(item.files?.every(file => typeof file.id === "string" && file.id.length === 26 && file.section?.id === item.sections?.[0]?.id));
  assert.notEqual(item.files?.[0]?.id, item.files?.[1]?.id);
  assert.equal(item.fields?.[0]?.section?.id, item.sections?.[0]?.id);
  assert.equal(await backend.execute(request("secret", "read", ["op://Private/Files/Docs/key.bin?attr=id"]), context), item.files?.[0]?.id);
  const edited = await backend.execute(request("item", "edit", [item.id, "Docs.note[delete]"]), context) as OpItem;
  assert.equal(edited.sections?.[0]?.id, item.sections?.[0]?.id);
  const added = await backend.execute(request("item", "edit", [item.id], { files: [...edited.files!, { name: "new.bin", section: { label: "New" }, content: new Uint8Array([2]) }] }), context) as OpItem;
  assert.equal(added.sections?.length, 2);
  assert.ok(added.files?.[2]?.id);
  assert.equal(added.files?.[2]?.section?.id, added.sections?.[1]?.id);
  assert.equal(Object.hasOwn(input.files[0]!, "id"), false);
});

test("password generation accepts native case and positive-sign recipes without changing request flags", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }] });
  for (const [recipe, length, alphabet] of [
    ["LETTERS,+20", 20, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"],
    ["DiGiTs,+01", 1, "0123456789"],
    ["SYMBOLS,64", 64, "!@.-_*"],
    ["letters,LETTERS", 32, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"],
    ["DIGITS,sYmBoLs,+20", 20, "0123456789!@.-_*"],
    ["+20", 20, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@.-_*"]
  ] as const) {
    const flags = Object.freeze({ category: "LOGIN", "generate-password": recipe });
    const created = await backend.execute(request("item", "create", [], undefined, flags), context) as OpItem;
    const edited = await backend.execute(request("item", "edit", [created.id], undefined, flags), context) as OpItem;
    for (const item of [created, edited]) {
      const password = item.fields?.find(field => field.purpose === "PASSWORD")?.value;
      assert.equal(typeof password, "string");
      assert.equal((password as string).length, length);
      assert.ok([...(password as string)].every(character => alphabet.includes(character)));
    }
    assert.equal(flags["generate-password"], recipe);
  }
  const before = backend.snapshot();
  for (const recipe of ["LETTERS, +20", "LETTERS,+20 ", "LETTERS,++20", "LETTERS,-20", "LETTERS,20,+20", "LETTERS,", "LETTERS,,DIGITS", '"LETTERS",20', "LETTERS,+65"]) {
    await assert.rejects(backend.execute(request("item", "create", [], undefined, { category: "LOGIN", "generate-password": recipe }), context));
    assert.deepEqual(backend.snapshot(), before);
  }
});

test("SSH hooks generate keys and transform reference formats without retained aliases", async () => {
  const fields: OpField[] = [{ id: "private_key", label: "private key", type: "SSHKEY", value: "private-material" }, { id: "public_key", label: "public key", type: "STRING", value: "public-material" }];
  const generated: string[] = [];
  const backend = createObjectBackend({ vaults: [{ id: "private", name: "Private" }], ssh: {
    async generate(type) { generated.push(type); return { category: "SSH_KEY", fields }; },
    async transform(source, format) { return `${format}:${source}`; }
  } });
  const item = await backend.execute(request("item", "create", [], undefined, { title: "Key", category: "SSH Key", "ssh-generate-key": true }), context) as OpItem;
  assert.deepEqual(generated, ["ed25519"]);
  assert.equal(item.category, "SSH_KEY");
  fields[0]!.value = "changed";
  for (const format of ["openssh", "pkcs1", "pkcs8"]) {
    assert.equal(await backend.execute(request("secret", "read", [`op://Private/Key/private key?ssh-format=${format}`]), context), `${format}:private-material`);
  }
  await assert.rejects(backend.execute(request("secret", "read", ["op://Private/Key/private key?ssh-format=invalid"]), context));
  assert.equal(backend.snapshot().ssh, undefined);
  await backend.execute(request("item", "create", [], undefined, { title: "RSA", "ssh-generate-key": "rsa2048" }), context);
  assert.deepEqual(generated, ["ed25519", "rsa2048"]);
});

test("SSH generation cancellation prevents publication and formatting observes cancellation", async () => {
  const reason = new Error("SSH cancelled");
  let controller = new AbortController();
  let calls = 0;
  const backend = createObjectBackend({ vaults: [{ id: "private", name: "Private" }], items: [{ id: "key", title: "Key", vault: "private", fields: [{ id: "private_key", label: "private key", type: "SSHKEY", value: "material" }] }], ssh: {
    async generate() { calls++; controller.abort(reason); return { category: "SSH_KEY", fields: [] }; },
    async transform() { controller.abort(reason); return "transformed"; }
  } });
  const before = backend.snapshot();
  await assert.rejects(backend.execute(request("item", "create", [], undefined, { "ssh-generate-key": true }), { signal: controller.signal }), error => error === reason);
  assert.deepEqual(backend.snapshot(), before);
  await assert.rejects(backend.execute(request("item", "create", [], undefined, { "ssh-generate-key": true }), { signal: controller.signal }), error => error === reason);
  assert.equal(calls, 1);
  controller = new AbortController();
  await assert.rejects(backend.execute(request("secret", "read", ["op://Private/Key/private key?ssh-format=openssh"]), { signal: controller.signal }), error => error === reason);
  const unavailable = createObjectBackend({ vaults: [{ id: "private", name: "Private" }] });
  await assert.rejects(unavailable.execute(request("item", "create", [], undefined, { "ssh-generate-key": true }), context));
});

test("SSH creation normalizes native case and RSA separator aliases only for the generation hook", async () => {
  const generated: string[] = [];
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], ssh: {
    async generate(type) { generated.push(type); return { category: "SSH_KEY", fields: [] }; },
    transform: source => source
  } });
  for (const [spelling, canonical] of [
    ["ed25519", "ed25519"], ["Ed25519", "ed25519"], ["ED25519", "ed25519"],
    ["rsa", "rsa"], ["RSA", "rsa"],
    ["rsa2048", "rsa2048"], ["RSA3072", "rsa3072"], ["RsA4096", "rsa4096"],
    ["rsa-2048", "rsa2048"], ["RSA-3072", "rsa3072"], ["rSa-4096", "rsa4096"]
  ] as const) {
    const flags = Object.freeze({ "ssh-generate-key": spelling });
    const created = await backend.execute(request("item", "create", [], undefined, flags), context) as OpItem;
    assert.equal(created.category, "SSH_KEY");
    assert.equal(generated.at(-1), canonical);
    assert.equal(flags["ssh-generate-key"], spelling);
  }
  const before = backend.snapshot();
  const calls = generated.length;
  for (const spelling of ["rsa-1024", "rsa--2048", "rsa_2048", "ed-25519", " rsa ", "ed25519\n"]) {
    await assert.rejects(backend.execute(request("item", "create", [], undefined, { "ssh-generate-key": spelling }), context), { message: "Unsupported SSH key type" });
    assert.equal(generated.length, calls);
    assert.deepEqual(backend.snapshot(), before);
  }
});

test("pending SSH generation does not overwrite concurrent item creation", async () => {
  let finish!: () => void;
  let announce!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const started = new Promise<void>(resolve => { announce = resolve; });
  const backend = createObjectBackend({ vaults: [{ id: "private", name: "Private" }], ssh: {
    async generate() { announce(); await pending; return { category: "SSH_KEY", fields: [{ id: "private_key", type: "SSHKEY", value: "material" }] }; },
    transform(source) { return source; }
  } });
  const generation = backend.execute(request("item", "create", [], undefined, { title: "Key", "ssh-generate-key": true }), context);
  await started;
  await backend.execute(request("item", "create", [], { title: "Concurrent" }), context);
  finish();
  await generation;
  assert.deepEqual((await backend.execute(request("item", "list"), context) as OpItem[]).map(item => item.title), ["Concurrent", "Key"]);
});

test("template dispatch and creation merge verified defaults before inputs and assignments", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "private", name: "Private" }], resources: { "item template": [{ id: "server", name: "Server", category: "SERVER", title: "", fields: [{ id: "host", type: "STRING", value: "localhost" }] }] } });
  assert.deepEqual(await backend.execute(request("item template", "list"), context), ["Login", "Server"]);
  const template = await backend.execute(request("item template", "get", ["login"]), context) as { fields: OpField[] };
  assert.equal(template.fields.length, 3);
  const item = await backend.execute(request("item", "create", ["username=assigned"], { fields: [{ id: "username", value: "input" }] }, { category: "Login", title: "Login" }), context) as OpItem;
  assert.equal(item.fields?.length, 3);
  assert.equal(item.fields?.find(field => field.id === "username")?.value, "assigned");
  assert.equal(item.fields?.find(field => field.id === "username")?.purpose, "USERNAME");
  assert.equal(item.fields?.find(field => field.id === "notesPlain")?.value, "");
  const server = await backend.execute(request("item", "create", [], undefined, { category: "Server", title: "Server" }), context) as OpItem;
  assert.equal(server.fields?.[0]?.value, "localhost");
  await assert.rejects(backend.execute(request("item template", "get", ["Credit Card"]), context), { message: "Item template schema is unavailable" });
  await assert.rejects(backend.execute(request("item", "create", [], undefined, { category: "Credit Card" }), context), { message: "Item template schema is unavailable" });
});

test("explicit input templates supply unverified categories without inventing defaults", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "private", name: "Private" }] });
  const input = { title: "Custom", category: "CUSTOM", fields: [{ id: "token", type: "CONCEALED", value: "provided" }], files: [{ id: "file", name: "data.bin", content: new Uint8Array([0, 255]) }] };
  const item = await backend.execute(request("item", "create", ["token=assigned"], input), context) as OpItem;
  assert.equal(item.category, "CUSTOM");
  assert.equal(item.fields?.length, 1);
  assert.equal(item.fields?.[0]?.value, "assigned");
  assert.deepEqual(item.files?.[0]?.content, new Uint8Array([0, 255]));
  assert.equal(input.fields[0]?.value, "provided");
  await assert.rejects(backend.execute(request("item", "create", [], { category: "CUSTOM", fields: [{ id: "missing-type" }] }), context));
});

test("document handler inputs normalize vaults and preserve binary ownership through edits", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "work", name: "Work" }, { id: "other", name: "Other" }] });
  const content = new Uint8Array([0, 255, 13, 10]);
  const document = await backend.execute(request("document", "create", [], { content, name: "data.bin", title: "Data", vault: "Work", tags: ["team"] }), context) as OpDocument;
  assert.deepEqual(document.vault, { id: "work", name: "Work" });
  assert.equal(document.state, "ACTIVE");
  content[0] = 99;
  const fetched = await backend.execute(request("document", "get", ["Data"], undefined, { vault: "Work" }), context) as OpDocument;
  assert.deepEqual(fetched.content, new Uint8Array([0, 255, 13, 10]));
  await assert.rejects(backend.execute(request("document", "get", [document.id], undefined, { vault: "Other" }), context));
  const edited = await backend.execute(request("document", "edit", [document.id], { content: new Uint8Array([4, 5]), name: "new.bin", title: "Updated", tags: ["new"] }, { vault: "Work" }), context) as OpDocument;
  assert.deepEqual(edited.vault, { id: "work", name: "Work" });
  assert.deepEqual(edited.tags, ["new"]);
  assert.deepEqual(edited.content, new Uint8Array([4, 5]));
  assert.deepEqual(await backend.execute(request("document", "list", [], undefined, { vault: "Other" }), context), []);
  await assert.rejects(backend.execute(request("document", "edit", [document.id], { vault: "missing" }), context));
  assert.deepEqual((await backend.execute(request("document", "get", [document.id]), context) as OpDocument).vault, edited.vault);
});

test("seeded documents normalize vault names and preserve archive and deleted states", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "work", name: "Work" }], documents: [{ id: "document", name: "data.bin", title: "Data", vault: "Work", content: new Uint8Array([255]) }] });
  assert.equal((await backend.execute(request("document", "list", [], undefined, { vault: "Work" }), context) as unknown[]).length, 1);
  await backend.execute(request("document", "delete", ["document"], undefined, { archive: true, vault: "Work" }), context);
  assert.deepEqual(await backend.execute(request("document", "list"), context), []);
  assert.equal((await backend.execute(request("document", "get", ["document"]), context) as OpDocument).state, "ARCHIVED");
  await assert.rejects(backend.execute(request("document", "get", ["Data"]), context));
  assert.equal((await backend.execute(request("document", "get", ["Data"], undefined, { "include-archive": true }), context) as OpDocument).id, "document");
  const restored = createObjectBackend(backend.snapshot());
  assert.deepEqual(await restored.execute(request("document", "list"), context), []);
  await restored.execute(request("document", "delete", ["document"]), context);
  await assert.rejects(restored.execute(request("document", "get", ["document"], undefined, { "include-archive": true }), context));
  assert.equal(restored.snapshot().documents?.[0]?.state, "DELETED");
  assert.deepEqual(restored.snapshot().documents?.[0]?.content, new Uint8Array([255]));
});

test("per-call admin hooks override factory hooks before generic CRUD", async () => {
  const backend = createObjectBackend({ adminHooks: { "account create": async () => ({ value: "factory" }) } });
  assert.equal(await backend.execute(request("account", "create"), context), "factory");
  const invocation: OpAdminContext = { ...context, adminHooks: { "account create": async () => ({ value: "invocation" }) } };
  assert.equal(await backend.execute(request("account", "create"), invocation), "invocation");
  assert.equal(await backend.execute(request("account", "create"), context), "factory");
  assert.deepEqual(backend.snapshot().accounts, []);
});

test("credential-producing commands reject missing hooks without mutating snapshots", async () => {
  const backend = createObjectBackend();
  const before = backend.snapshot();
  for (const [resource, action] of [["account", "add"], ["signin", ""], ["service-account", "create"], ["service-account", "ratelimit"], ["connect server", "create"], ["connect token", "create"], ["events-api", "create"], ["user", "provision"], ["user recovery", "begin"], ["plugin", "init"], ["plugin", "run"]] as const) {
    await assert.rejects(backend.execute(request(resource, action), context), { message: "Admin command requires an injected hook" });
  }
  assert.deepEqual(backend.snapshot(), before);
});

test("item OTP and secret metadata use the primary OTP field and RFC6238 clock", async (testContext) => {
  testContext.mock.method(Date, "now", () => 59_000);
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [{ id: "item", title: "Login", vault: "vault", fields: [{ id: "password", value: "not-an-otp", type: "CONCEALED" }, { id: "otp", label: "one-time password", type: "OTP", value: "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8" }] }] });
  assert.equal(await backend.execute(request("item", "get", ["item"], undefined, { otp: true }), context), "94287082");
  assert.equal(await backend.execute(request("secret", "read", ["op://Private/Login/one-time password?attribute=otp"]), context), "94287082");
  assert.equal(await backend.execute(request("secret", "read", ["op://Private/Login/otp?attr=otp"]), context), "94287082");
  await assert.rejects(backend.execute(request("secret", "read", ["op://Private/Login/password?attribute=otp"]), context));
});

test("item OTP rejects missing and malformed OTP values", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [{ id: "empty", title: "Empty", vault: "vault" }, { id: "invalid", title: "Invalid", vault: "vault", fields: [{ id: "otp", type: "OTP", value: "!invalid!" }] }] });
  await assert.rejects(backend.execute(request("item", "get", ["empty"], undefined, { otp: true }), context));
  await assert.rejects(backend.execute(request("item", "get", ["invalid"], undefined, { otp: true }), context));
});

test("OTP reads observe cancellation after asynchronous generation", async (testContext) => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [{ id: "item", title: "Login", vault: "vault", fields: [{ id: "otp", type: "OTP", value: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" }] }] });
  const original = crypto.subtle.sign.bind(crypto.subtle);
  let controller = new AbortController();
  const reason = new Error("cancelled during OTP");
  testContext.mock.method(crypto.subtle, "sign", async (...args: Parameters<typeof original>) => {
    const result = await original(...args);
    controller.abort(reason);
    return result;
  });
  for (const operation of [request("item", "get", ["item"], undefined, { otp: true }), request("secret", "read", ["op://Private/Login/otp?attr=otp"])]) {
    controller = new AbortController();
    await assert.rejects(backend.execute(operation, { signal: controller.signal }), error => error === reason);
  }
});

test("admin dispatch shares backend state with vault CRUD and persistent snapshots", async () => {
  const backend = createObjectBackend({ accounts: [{ id: "account", name: "Work" }], vaults: [{ id: "vault", name: "Private" }], resources: { user: [{ id: "user", email: "alice@example.com", state: "ACTIVE" }] } });
  const group = await backend.execute(request("group", "create", ["Engineering"], undefined, { description: "Team" }), context) as { id: string };
  await backend.execute(request("group user", "grant", [], undefined, { group: group.id, user: "alice@example.com", role: "manager" }), context);
  const members = await backend.execute(request("group user", "list", [group.id]), context) as { id: string; role: string }[];
  assert.deepEqual(members.map(member => [member.id, member.role]), [["user", "manager"]]);
  await backend.execute(request("vault user", "grant", [], undefined, { vault: "Private", user: "user", permissions: ["view_items"] }), context);
  assert.equal((await backend.execute(request("vault", "list", [], undefined, { user: "user" }), context) as unknown[]).length, 1);
  const restored = createObjectBackend(backend.snapshot());
  assert.deepEqual(await restored.execute(request("group user", "list", [group.id]), context), members);
  await backend.execute(request("user", "suspend", ["user"]), context);
  assert.equal(backend.snapshot().resources?.user?.[0]?.state, "SUSPENDED");
  assert.equal(restored.snapshot().resources?.user?.[0]?.state, "ACTIVE");
});

test("injected admin hooks publish detached state and respect cancellation", async () => {
  const supplied = { id: "account", name: "Work" };
  const backend = createObjectBackend({ adminHooks: { "account add": async (_request, suppliedContext) => {
    assert.equal(suppliedContext.signal, context.signal);
    return { value: supplied, resources: { account: [supplied] } };
  } } });
  await backend.execute(request("account", "add"), context);
  supplied.name = "Changed";
  assert.equal((await backend.execute(request("account", "get"), context) as { name: string }).name, "Work");
  assert.equal(backend.snapshot().adminHooks, undefined);
  const controller = new AbortController();
  const reason = new Error("stop admin");
  const cancelled = createObjectBackend({ adminHooks: { "account add": async () => {
    controller.abort(reason);
    return { resources: { account: [supplied] } };
  } } });
  await assert.rejects(cancelled.execute(request("account", "add"), { signal: controller.signal }), error => error === reason);
  assert.deepEqual(cancelled.snapshot().accounts, []);
});

test("vault and item CRUD resolves scoped names and preserves structured metadata", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Work" }] });
  const item = await backend.execute(request("item", "create", [], { title: "Login", vault: "Work", fields: [{ id: "password", value: "secret" }], metadata: { owner: "team" } }), context) as OpItem;
  assert.equal(item.vault.id, "vault");
  assert.deepEqual(await backend.execute(request("item", "get", ["Login"], undefined, { vault: "Work" }), context), { ...item, fields: [{ id: "password", value: "secret", reference: `op://vault/${item.id}/password` }] });
  const updated = await backend.execute(request("item", "edit", [item.id], { metadata: { color: "blue" } }), context) as OpItem;
  assert.deepEqual(updated.metadata, { owner: "team", color: "blue" });
  await assert.rejects(backend.execute(request("vault", "delete", ["Work"]), context));
  await backend.execute(request("item", "delete", [item.id]), context);
  assert.deepEqual(await backend.execute(request("item", "list"), context), []);
  await backend.execute(request("vault", "edit", ["Work"], { name: "Renamed" }), context);
  await backend.execute(request("vault", "delete", ["Renamed"]), context);
  assert.deepEqual(await backend.execute(request("vault", "list"), context), []);
});

test("generic resource CRUD covers accounts, documents and extension resources", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "private", name: "Private" }], accounts: [{ id: "account", name: "Team" }], resources: { group: [{ id: "group", name: "Engineering" }] } });
  for (const resource of ["account", "document", "group", "custom"]) {
    const created = await backend.execute(request(resource, "create", [], { name: "New", content: new Uint8Array([0, 255]) }), context) as { id: string };
    assert.ok(created.id);
    await backend.execute(request(resource, "update", [created.id], { name: "Updated" }), context);
    assert.equal((await backend.execute(request(resource, "get", [created.id]), context) as { name: string }).name, "Updated");
    await backend.execute(request(resource, "delete", [created.id]), context);
    await assert.rejects(backend.execute(request(resource, "get", [created.id]), context));
  }
});

test("state is isolated from seed, requests and returned values", async () => {
  const seed = { vaults: [{ id: "vault", name: "Work", metadata: { count: 1 } }] };
  const backend = createObjectBackend(seed);
  seed.vaults[0]!.metadata.count = 2;
  const first = await backend.execute(request("vault", "get", ["vault"]), context) as typeof seed.vaults[number];
  assert.equal(first.metadata.count, 1);
  first.metadata.count = 3;
  assert.equal((await backend.execute(request("vault", "get", ["vault"]), context) as typeof first).metadata.count, 1);
});

test("snapshot exports independent state that can seed another backend", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Work" }], resources: { group: [{ id: "group", name: "Team" }] } });
  await backend.execute(request("item", "create", [], { id: "item", title: "Login", vault: "Work", fields: [{ id: "password", value: "secret" }] }), context);
  const snapshot = backend.snapshot();
  const restored = createObjectBackend(JSON.parse(JSON.stringify(snapshot)));
  snapshot.vaults![0]!.name = "Changed";
  assert.equal((await backend.execute(request("vault", "get", ["vault"]), context) as { name: string }).name, "Work");
  assert.deepEqual(await restored.execute(request("item", "list"), context), await backend.execute(request("item", "list"), context));
  assert.deepEqual(await restored.execute(request("group", "list"), context), [{ id: "group", name: "Team" }]);
});

test("restoring snapshots preserves binary isolation and avoids nested ID collisions", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }] });
  const item = await backend.execute(request("item", "create", ["custom=first"], { title: "Test", files: [{ id: "file", name: "data", content: new Uint8Array([1, 2]) }] }), context) as OpItem;
  const snapshot = backend.snapshot();
  const restored = createObjectBackend(snapshot);
  const edited = await restored.execute(request("item", "edit", [item.id, "another=second"]), context) as OpItem;
  assert.equal(new Set(edited.fields?.map(field => field.id)).size, 2);
  const returned = await restored.execute(request("secret", "read", ["op://Private/Test/data"]), context) as Uint8Array;
  returned[0] = 99;
  assert.deepEqual(await restored.execute(request("secret", "read", ["op://Private/Test/data"]), context), new Uint8Array([1, 2]));
});

test("failed assignments are atomic and archived references do not expose secrets", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }] });
  const item = await backend.execute(request("item", "create", ["password=original"], { title: "Test" }), context) as OpItem;
  await assert.rejects(backend.execute(request("item", "edit", [item.id, "password=changed", "bad[file]=host-path"]), context));
  assert.equal(await backend.execute(request("secret", "read", ["op://Private/Test/password"]), context), "original");
  await backend.execute(request("item", "delete", [item.id], undefined, { archive: true }), context);
  await assert.rejects(backend.execute(request("secret", "read", ["op://Private/Test/password"]), context));
});

test("item flags set metadata", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Work" }] });
  const created = await backend.execute(request("item", "create", [], undefined, { vault: "Work", title: "Login", category: "LOGIN" }), context) as OpItem;
  assert.equal(created.title, "Login");
  assert.equal(created.category, "LOGIN");
  assert.equal(created.vault.id, "vault");
  const edited = await backend.execute(request("item", "edit", [created.id], undefined, { title: "Renamed" }), context) as OpItem;
  assert.equal(edited.title, "Renamed");
});

test("password recipes generate secure fields and field selectors return only requested fields", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "private", name: "Private" }] });
  const item = await backend.execute(request("item", "create", ["username=alice"], undefined, { title: "Login", category: "Login", "generate-password": true }), context) as OpItem;
  assert.equal(item.fields?.find(field => field.id === "password")?.value?.length, 32);
  const edited = await backend.execute(request("item", "edit", [item.id], undefined, { "generate-password": "digits,20" }), context) as OpItem;
  const password = edited.fields?.find(field => field.id === "password")?.value;
  assert.equal(password?.length, 20);
  assert.ok([...password!].every(character => "0123456789".includes(character)));
  const fields = await backend.execute(request("item", "get", [item.id], undefined, { fields: ["label=username", "type=concealed"] }), context) as OpField[];
  assert.equal(fields.length, 2);
  assert.equal(fields[0]?.value, "alice");
  await assert.rejects(backend.execute(request("item", "edit", [item.id], undefined, { "generate-password": "digits,65" }), context));
  await assert.rejects(backend.execute(request("item", "edit", [item.id], undefined, { "generate-password": "unknown,20" }), context));
});

test("CLI vault flags and item escaped assignments override templates", async () => {
  const backend = createObjectBackend();
  const vault = await backend.execute(request("vault", "create", ["Private"], undefined, { description: "Personal" }), context) as { id: string; description: string };
  assert.equal(vault.id.length, 26);
  assert.ok([...vault.id].every(character => "abcdefghijklmnopqrstuvwxyz0123456789".includes(character)));
  assert.equal(vault.description, "Personal");
  await backend.execute(request("vault", "edit", [vault.id], undefined, { name: "Work", "travel-mode": "on" }), context);
  const item = await backend.execute(request("item", "create", ["-", "username=alice", "Access.token[password]=a=b", "literal\\.name[text]=value"], { fields: [{ id: "username", purpose: "USERNAME", value: "old" }] }, { vault: "Work", title: "Login", category: "Login", tags: ["team/sub", "prod"] }), context) as OpItem;
  assert.equal(item.id.length, 26);
  assert.equal(item.fields?.find(field => field.id === "username")?.value, "alice");
  assert.equal(item.fields?.find(field => field.label === "token")?.value, "a=b");
  assert.equal(item.fields?.find(field => field.label === "literal.name")?.value, "value");
  const edited = await backend.execute(request("item", "edit", [item.id, "Access.token[delete]", "username="], undefined), context) as OpItem;
  assert.equal(edited.fields?.find(field => field.id === "username")?.value, "");
  assert.equal(edited.sections?.length, 0);
  await assert.rejects(backend.execute(request("item", "edit", [item.id, "username[delete]"]), context));
  assert.equal((await backend.execute(request("item", "list", [], undefined, { tags: ["team"], categories: ["Login"] }), context) as unknown[]).length, 1);
});

test("archive, deleted retention, dry runs and move preserve lifecycle", async () => {
  const backend = createObjectBackend({ defaultVault: "private", vaults: [{ id: "private", name: "Private" }, { id: "work", name: "Work" }] });
  const item = await backend.execute(request("item", "create", [], undefined, { title: "Login", category: "LOGIN" }), context) as OpItem;
  await backend.execute(request("item", "edit", [item.id], undefined, { title: "Preview", "dry-run": true }), context);
  assert.equal((await backend.execute(request("item", "get", [item.id]), context) as OpItem).title, "Login");
  await backend.execute(request("item", "delete", [item.id], undefined, { archive: true }), context);
  assert.deepEqual(await backend.execute(request("item", "list"), context), []);
  assert.equal((await backend.execute(request("item", "get", [item.id]), context) as OpItem).state, "ARCHIVED");
  await assert.rejects(backend.execute(request("item", "get", ["Login"]), context));
  assert.equal((await backend.execute(request("item", "get", ["Login"], undefined, { "include-archive": true }), context) as OpItem).id, item.id);
  const moved = await backend.execute(request("item", "move", [item.id], undefined, { "destination-vault": "Work" }), context) as OpItem;
  assert.notEqual(moved.id, item.id);
  assert.equal(moved.vault.id, "work");
  await assert.rejects(backend.execute(request("item", "get", [item.id]), context));
  assert.equal(backend.snapshot().items?.find(entry => entry.id === item.id)?.state, "DELETED");
});

test("duplicates, ambiguous names, invalid requests and cancellation cannot mutate state", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "first", name: "Same" }, { id: "second", name: "Same" }] });
  await assert.rejects(backend.execute(request("vault", "get", ["Same"]), context));
  await assert.rejects(backend.execute(request("vault", "create", [], { id: "first" }), context));
  await assert.rejects(backend.execute(request("vault", "edit", ["first"], { id: "second" }), context));
  await assert.rejects(backend.execute(request("vault", "destroy"), context));
  await assert.rejects(backend.execute(request("item", "create", [], { title: "No vault" }), context));
  const controller = new AbortController();
  const reason = new Error("stop");
  controller.abort(reason);
  await assert.rejects(backend.execute(request("vault", "delete", ["first"]), { signal: controller.signal }), error => error === reason);
  assert.equal((await backend.execute(request("vault", "list"), context) as unknown[]).length, 2);
});
