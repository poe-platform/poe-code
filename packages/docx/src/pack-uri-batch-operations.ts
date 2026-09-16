import { DocxUsageError } from "./argument-json.js";
import { PackURI } from "./pack-uri.js";

type Action = (receiver: unknown, args: Readonly<Record<string, unknown>>) => unknown;
export const packUriBatchActions = new Map<string, Action>();
const prefix = "model.opc.packuri.PackURI";
packUriBatchActions.set(`${prefix}.call`, (_receiver, args) => new PackURI(args.packUriStr as string));
packUriBatchActions.set(`${prefix}.from_rel_ref.call`, (_receiver, args) => {
  return PackURI.from_rel_ref(args.baseURI as string, args.relativeRef as string);
});
for (const name of ["baseURI", "ext", "filename", "idx", "membername", "rels_uri"] as const) {
  packUriBatchActions.set(`${prefix}.${name}.get`, receiver => {
    if (!(receiver instanceof PackURI)) throw new DocxUsageError("Expected a checked package URI receiver.");
    return receiver[name];
  });
}
packUriBatchActions.set(`${prefix}.relative_ref.call`, (receiver, args) => {
  if (!(receiver instanceof PackURI)) throw new DocxUsageError("Expected a checked package URI receiver.");
  return receiver.relative_ref(args.baseURI as string);
});
packUriBatchActions.set(`${prefix}.string_protocol.call`, receiver => {
  if (!(receiver instanceof PackURI)) throw new DocxUsageError("Expected a checked package URI receiver.");
  return receiver.toString();
});
