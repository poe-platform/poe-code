import {
  Presentation, createPresentation, readPresentationText,
  replacePresentationText, addImage, mergeSlides,
  applyTemplateBindings, applyTemplateRepeat, createPptxCommandEngine,
  Inches, OfficeError,
  type SelectionContext, type ByteSink, type PresentationContext,
  type PptxCommandEngineOptions, type TemplateBinding
} from "pptx";
import { readBinary, writeBinary } from "pptx/bytes";

declare const context: SelectionContext;
declare const sink: ByteSink;
const input = await createPresentation({ slides: [{ shapes: [{
  name: "heading", x: 0, y: 0, width: 3657600, height: 914400,
  text: "Draft coastal survey"
}] }] }, context);
const text = await readPresentationText(input, {}, context);
const edited = await replacePresentationText(input, {
  find: "Draft", with: "Final", all: true
}, context);
const combined = await mergeSlides(edited.bytes, [input], {
  themePolicy: "source", dimensionPolicy: "reject"
}, context);
const presentation = await Presentation(combined, context);
presentation.core_properties.title = "Coastal survey";
// The caller supplies sink: ByteSink; it owns transport and publication.
await presentation.save(sink);
