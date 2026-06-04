declare module "uri-template-lite" {
  export default class UriTemplate {
    constructor(template: string);
    match(uri: string): Record<string, string | string[]> | null;
  }
}
