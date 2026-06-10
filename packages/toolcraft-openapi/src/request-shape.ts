export const REQUEST_PARAM_SECTIONS = [
  { location: "path", key: "pathParams", omittable: false },
  { location: "query", key: "query", omittable: false },
  { location: "header", key: "headers", omittable: false },
  { location: "body", key: "body", omittable: true }
] as const;

export type RequestParamSection = (typeof REQUEST_PARAM_SECTIONS)[number];
export type RequestSectionKey = RequestParamSection["key"];
