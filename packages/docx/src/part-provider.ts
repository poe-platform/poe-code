import type { StoryPart, XmlPartView } from "./package-view.js";
import { docxOperationSchemas, splitDocxType } from "./operation-schema.js";

/** A live model owner whose part supports native story operations. */
export interface ProvidesStoryPart { readonly part: StoryPart }
/** A live model owner whose part supports bounded XML access. */
export interface ProvidesXmlPart { readonly part: XmlPartView }

const nativeStoryTypes = ["DocumentPart", "StoryPart", "HeaderPart", "FooterPart", "CommentsPart"];
const xmlPartTypes = [...nativeStoryTypes, "XmlPart", "XmlPartView", "PartView", "Part", "SettingsPart", "StylesPart", "NumberingPart", "CorePropertiesPart"];
export const partProviderReceivers = new Map<string, ReadonlySet<string>>();
for (const [protocol, types] of [["ProvidesStoryPart", nativeStoryTypes], ["ProvidesXmlPart", xmlPartTypes]] as const) {
  const receivers = new Set<string>(types);
  for (const [id, schema] of Object.entries(docxOperationSchemas))
    if (id.endsWith(".part.get") && schema.receiver && splitDocxType(schema.valueType).every(type => types.includes(type))) receivers.add(schema.receiver);
  // A general XML/part handle can carry a native story. Runtime dispatch checks its role.
  if (protocol === "ProvidesStoryPart") for (const type of ["Part", "PartView", "XmlPart", "XmlPartView"]) receivers.add(type);
  partProviderReceivers.set(protocol, receivers);
}
