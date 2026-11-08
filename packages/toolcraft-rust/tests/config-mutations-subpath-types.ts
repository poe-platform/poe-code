import * as native from "toolcraft-rust/config-mutations";
import * as reference from "toolcraft/config-mutations";
const own: typeof reference = native;
const original: typeof native = reference;
declare const context: native.MutationContext;
const referenceContext: reference.MutationContext = context;
const ownContext: native.MutationContext = referenceContext;
const doc: native.ConfigObject = { value: ["a", new Date(), null] };
const mutation: native.Mutation = native.configMutation.transform({target: "/config.json", transform(value, options) {
  const originalDoc: reference.ConfigObject = value;
  void options;
  return {content: originalDoc, changed: true};
}});
const result: Promise<native.MutationResult> = native.runMutations([mutation], context);
const variables: native.TemplateVariables = {name: "Native", flags: ["one"]};
const rendered: string = native.renderTemplate("{{name}}", variables);
declare const format: native.ConfigFormat;
const originalFormat: reference.ConfigFormat = format;
declare const mapper: native.PathMapper;
declare const loader: native.TemplateLoader;
const originalMapper: reference.PathMapper = mapper;
const originalLoader: reference.TemplateLoader = loader;
// @ts-expect-error mutation format names are a closed union
native.configMutation.merge({target: "/config", value: {}, format: "xml"});
// @ts-expect-error implementation-only mutation option types are not public exports
type Extra = native.MutationOptions;
void [own, original, ownContext, doc, result, rendered, originalFormat, originalMapper, originalLoader];
export type {Extra};
