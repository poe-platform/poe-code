const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const identified = [1, 2, 3].map(id => `<w:comment w:id="${id}"/>`).join("");
export const commentsSourceCases = [
  { row: 789, action: "count", initial: "", expected: 0 },
  { row: 790, action: "count", initial: "<w:comment/>", expected: 1 },
  { row: 791, action: "count", initial: "<w:comment/><w:comment/><w:comment/>", expected: 3 },
  { row: 792, action: "iterate", initial: "<w:comment/><w:comment/>", expected: 2 },
  { row: 793, action: "lookup", initial: identified, id: 2, expected: 2 },
  { row: 794, action: "lookup", initial: identified, id: 4, expected: null },
  { row: 795, action: "add", initial: "", paragraphs: [""] },
  { row: 796, action: "add", initial: "", text: "para 1\n\npara 2", paragraphs: ["para 1", "", "para 2"] },
  { row: 797, action: "add", initial: "", author: "Steve Canny", initials: "SJC", paragraphs: [""] },
  { row: 798, action: "property", attribute: "", field: "comment_id", expected: 42 },
  { row: 799, action: "property", attribute: ' w:author="Steve Canny"', field: "author", expected: "Steve Canny" },
  { row: 800, action: "property", attribute: ' w:initials="SJC"', field: "initials", expected: "SJC" },
  { row: 801, action: "property", attribute: ' w:date="2023-10-01T12:34:56Z"', field: "timestamp", expected: "2023-10-01T12:34:56.000Z" },
  { row: 802, action: "text", body: "", expected: "" },
  { row: 803, action: "text", body: para("Comment text."), expected: "Comment text." },
  { row: 804, action: "text", body: para("First para") + para("Second para"), expected: "First para\nSecond para" },
  { row: 805, action: "text", body: para("First para") + "<w:p/>" + para("Second para"), expected: "First para\n\nSecond para" },
  { row: 806, action: "paragraphs", body: para("First para") + para("Second para"), expected: ["First para", "Second para"] },
  { row: 807, action: "set", attribute: ' w:author="Old Author"', field: "author", value: "New Author" },
  { row: 808, action: "set", attribute: ' w:initials="ABC"', field: "initials", value: "XYZ" },
  { row: 809, action: "set", attribute: ' w:initials="ABC"', field: "initials", value: "" },
  { row: 810, action: "set", attribute: ' w:initials="ABC"', field: "initials", value: null }
] as const;
export type CommentsSourceCase = typeof commentsSourceCases[number];
export function commentsSourceBody(c: CommentsSourceCase) {
  return "initial" in c ? c.initial : `<w:comment w:id="42"${"attribute" in c ? c.attribute : ""}>${"body" in c ? c.body : ""}</w:comment>`;
}
