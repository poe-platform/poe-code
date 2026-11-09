import { encodeUtf8 } from "../binary.js";
import { MediaBudgetTracker, type MediaAstPlugin } from "../types.js";

export function amrAst(): MediaAstPlugin {
  return {
    id: "amr", formatName: "amr", formatLongName: "3GPP AMR",
    extensions: ["amr"], mimeTypes: ["audio/amr", "audio/amr-wb"],
    canDemux: false, canMux: true,
    supportedVideoCodecs: [], supportedAudioCodecs: ["amr_nb", "amr_wb"],
    detect() { return false; },
    parse() { throw new Error("AMR input is not supported"); },
    probe() { throw new Error("AMR input is not supported"); },
    serialize(doc, options = {}) {
      const track = doc.tracks[0];
      if (doc.tracks.length !== 1 || track?.type !== "audio") {
        throw new Error("AMR output requires exactly one audio stream");
      }
      const codec = track.codecDescriptions[0]?.codecName;
      if ((codec !== "amr_nb" && codec !== "amr_wb") || track.codecDescriptions.some(
        description => description.codecName !== codec || description.channels !== 1
      )) {
        throw new Error("AMR output requires mono AMR-NB or AMR-WB packets");
      }
      const budget = options.budget ?? new MediaBudgetTracker(options.limits);
      const header = encodeUtf8(codec === "amr_wb" ? "#!AMR-WB\n" : "#!AMR\n");
      let size = header.length;
      for (const sample of track.samples) {
        budget.checkCpu();
        size += sample.data.length;
      }
      budget.checkOutputBytes(size);
      budget.allocateMemory(size);
      const bytes = new Uint8Array(size);
      bytes.set(header);
      let offset = header.length;
      for (const sample of track.samples) {
        budget.checkCpu();
        bytes.set(sample.data, offset);
        offset += sample.data.length;
      }
      return bytes;
    }
  };
}
