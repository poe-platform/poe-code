/** Extension storage is identified by content type, relationship and expanded root name. */
export const commentExtensionParts = [
  { kind: "commentsExtended", root: "commentsEx", namespace: "http://schemas.microsoft.com/office/word/2012/wordml", relationship: "http://schemas.microsoft.com/office/2011/relationships/commentsExtended", entry: "commentEx" },
  { kind: "commentsIds", root: "commentsIds", namespace: "http://schemas.microsoft.com/office/word/2016/wordml/cid", relationship: "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds", entry: "commentId" },
  { kind: "commentsExtensible", root: "commentsExtensible", namespace: "http://schemas.microsoft.com/office/word/2018/wordml/cex", relationship: "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible", entry: "commentExtensible" },
  { kind: "people", root: "people", namespace: "http://schemas.microsoft.com/office/word/2012/wordml", relationship: "http://schemas.microsoft.com/office/2011/relationships/people", entry: "person" }
].map(part => ({ ...part, contentType: `application/vnd.openxmlformats-officedocument.wordprocessingml.${part.kind}+xml` }));
