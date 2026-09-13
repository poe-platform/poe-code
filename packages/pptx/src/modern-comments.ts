import { SaxesParser } from "saxes";
import { attr, invalid, type loadShared } from "./masters.js";
import type { CommentRecord } from "./comments.js";
import type { XmlElement, XmlPart } from "./xml.js";

export const modernCommentsRelationship =
  "http://schemas.microsoft.com/office/2018/10/relationships/comments";
const namespace = "http://schemas.microsoft.com/office/powerpoint/2018/8/main";
const reactionNamespace = "http://schemas.microsoft.com/office/powerpoint/2022/03/main";
type State = Awaited<ReturnType<typeof loadShared>>;
export interface ModernAuthorIdentity {
  readonly id: string;
  readonly name: string;
  readonly initials: string | null;
  readonly userId: string;
  readonly providerId: string;
  readonly part: string;
  readonly xml: string;
}
export interface ModernCommentRecord extends Omit<CommentRecord, "index"> {
  readonly format: "modern";
  readonly index: null;
  readonly status: string;
  readonly threadId: string;
  readonly parentId: string | null;
  readonly authorIdentity: ModernAuthorIdentity | null;
  readonly replies: readonly ModernCommentRecord[];
  readonly reactions: readonly {
    readonly type: string;
    readonly instances: readonly { readonly authorId: string; readonly timestamp: string }[];
  }[];
  readonly opaqueXml: string;
}
function children(node: XmlElement, local: string, ns = namespace) {
  return node.children.filter((n) => n.name.namespace === ns && n.name.localName === local);
}
function required(node: XmlElement, name: string) {
  const value = attr(node, name);
  if (value === undefined) invalid("Modern comment metadata is missing.");
  return value;
}
function content(doc: XmlPart, body: XmlElement | undefined) {
  if (!body) return "";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  return children(body, "p", a)
    .map((p) =>
      p.children
        .map((n) => {
          if (n.name.namespace !== a) return "";
          if (n.name.localName === "br") return "\v";
          if (!["r", "fld"].includes(n.name.localName)) return "";
          return children(n, "t", a)
            .map((t) => {
              let value = "";
              const parser = new SaxesParser({ xmlns: true });
              parser.on("text", (v) => (value += v));
              parser.on("cdata", (v) => (value += v));
              parser.write(doc.markup(t, true)).close();
              return value;
            })
            .join("");
        })
        .join("")
    )
    .join("\n");
}
export function modernCommentAuthors(s: State): ModernAuthorIdentity[] {
  const authors: ModernAuthorIdentity[] = [];
  for (const edge of s.index.inventory.relationships.filter(
    (e) =>
      e.owner === s.main &&
      !e.external &&
      e.type === "http://schemas.microsoft.com/office/2018/10/relationships/authors"
  )) {
    const doc = s.doc(edge.targetPart!);
    if (doc.root.name.namespace !== namespace || doc.root.name.localName !== "authorLst")
      invalid("Invalid modern author list.");
    for (const node of children(doc.root, "author"))
      authors.push({
        id: required(node, "id"),
        name: required(node, "name"),
        initials: attr(node, "initials") ?? null,
        userId: required(node, "userId"),
        providerId: required(node, "providerId"),
        part: edge.targetPart!,
        xml: doc.markup(node, true)
      });
  }
  if (new Set(authors.map((a) => a.id)).size !== authors.length)
    invalid("Duplicate modern author identities.");
  return authors;
}
export function modernCommentRecords(
  s: State,
  slides: State["index"]["slides"]
): ModernCommentRecord[] {
  const authors = modernCommentAuthors(s);
  return slides.flatMap((slide) =>
    s.index.inventory.relationships
      .filter((e) => e.owner === slide.part && !e.external && e.type === modernCommentsRelationship)
      .flatMap((edge) => {
        const part = edge.targetPart!,
          doc = s.doc(part);
        if (doc.root.name.namespace !== namespace || doc.root.name.localName !== "cmLst")
          invalid("Invalid modern comment list.");
        const ids = new Set<string>();
        function record(
          node: XmlElement,
          threadId: string,
          parentId: string | null
        ): ModernCommentRecord {
          const id = required(node, "id"),
            authorId = required(node, "authorId");
          if (ids.has(id)) invalid("Duplicate modern comment identities.");
          ids.add(id);
          const authorIdentity = authors.find((a) => a.id === authorId) ?? null;
          const location = {
            fingerprint: s.index.fingerprint,
            scope: "slides" as const,
            owner: part,
            objectId: id,
            coordinateSystem: "identity" as const
          };
          const pos = children(node, "pos")[0];
          const coordinate = (key: string) => {
            const value = pos ? attr(pos, key) : undefined;
            if (value === undefined) return 0;
            const digits = value.startsWith("-") || value.startsWith("+") ? value.slice(1) : value;
            if (
              !digits ||
              [...digits].some((c) => c < "0" || c > "9") ||
              !Number.isSafeInteger(Number(value))
            )
              invalid("Invalid modern comment position.");
            return Number(value);
          };
          const reactions: {
            type: string;
            instances: { authorId: string; timestamp: string }[];
          }[] = [];
          for (const list of children(node, "extLst"))
            for (const ext of children(
              list,
              "ext",
              "http://schemas.openxmlformats.org/presentationml/2006/main"
            ))
              for (const group of children(ext, "reactions", reactionNamespace))
                for (const reaction of children(group, "rxn", reactionNamespace))
                  reactions.push({
                    type: required(reaction, "type"),
                    instances: children(reaction, "instance", reactionNamespace).map((n) => ({
                      authorId: required(n, "authorId"),
                      timestamp: required(n, "time")
                    }))
                  });
          return {
            id,
            selector: JSON.stringify(location),
            location,
            slide: slide.position,
            part,
            authorId,
            index: null,
            author: authorIdentity?.name ?? "",
            initials: authorIdentity?.initials ?? "",
            text: content(doc, children(node, "txBody")[0]),
            timestamp: required(node, "created"),
            left: coordinate("x"),
            top: coordinate("y"),
            format: "modern",
            status: attr(node, "status") ?? "active",
            threadId,
            parentId,
            authorIdentity,
            replies: children(node, "replyLst").flatMap((list) =>
              children(list, "reply").map((reply) => record(reply, threadId, id))
            ),
            reactions,
            opaqueXml: doc.markup(node, true)
          };
        }
        return children(doc.root, "cm").map((node) => record(node, required(node, "id"), null));
      })
  );
}
