import { beforeEach, describe, expect, it, vi } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import { JETBRAINS_MONO_FONT_FILES } from "./font.js";
import { renderPng } from "./png-renderer.js";

const renderMock = vi.fn(() => ({
  asPng: () => new Uint8Array([1, 2, 3])
}));

vi.mock("@resvg/resvg-js", () => ({
  Resvg: vi.fn(function MockResvg() {
    return {
    render: renderMock
    };
  })
}));

describe("renderPng options", () => {
  beforeEach(() => {
    vi.mocked(Resvg).mockClear();
    renderMock.mockClear();
  });

  it("renders at 4x zoom scale", () => {
    const png = renderPng("<svg />");

    expect(Resvg).toHaveBeenCalledWith("<svg />", {
      font: {
        defaultFontFamily: "JetBrains Mono",
        fontFiles: JETBRAINS_MONO_FONT_FILES,
        loadSystemFonts: false,
        monospaceFamily: "JetBrains Mono"
      },
      fitTo: {
        mode: "zoom",
        value: 4
      }
    });
    expect(renderMock).toHaveBeenCalled();
    expect(png).toEqual(Buffer.from([1, 2, 3]));
  });
});
