import { describe, expect, it } from "vitest";

import { getInlineTextEditorMetrics } from "./textEditorMetrics";

describe("getInlineTextEditorMetrics", () => {
  it("keeps text at its logical font size at 100% zoom", () => {
    const metrics = getInlineTextEditorMetrics({
      text: "Note",
      fontSize: 24,
      viewportZoom: 1,
    });

    expect(metrics.fontSize).toBe(24);
    expect(metrics.scale).toBe(1);
    expect(metrics.visualFontSize).toBe(24);
  });

  it("scales visible text size at minimum viewport zoom", () => {
    const metrics = getInlineTextEditorMetrics({
      text: "Tiny note",
      fontSize: 24,
      viewportZoom: 0.25,
    });

    expect(metrics.fontSize).toBe(24);
    expect(metrics.scale).toBe(0.25);
    expect(metrics.visualFontSize).toBe(6);
  });

  it("grows the editor height for multiline text", () => {
    const singleLineMetrics = getInlineTextEditorMetrics({
      text: "One line",
      fontSize: 24,
      viewportZoom: 1,
    });
    const multilineMetrics = getInlineTextEditorMetrics({
      text: "One line\nSecond line",
      fontSize: 24,
      viewportZoom: 1,
    });

    expect(multilineMetrics.height).toBeGreaterThan(singleLineMetrics.height);
  });

  it("uses line height for single-line editor height", () => {
    const metrics = getInlineTextEditorMetrics({
      text: "One line",
      fontSize: 24,
      viewportZoom: 1,
    });

    expect(metrics.height).toBeCloseTo(31.2, 4);
  });

  it("uses measured text width when a canvas measurer is available", () => {
    const metrics = getInlineTextEditorMetrics({
      text: "Nikita",
      fontSize: 24,
      viewportZoom: 1,
      measureTextWidth: () => 66,
    });

    expect(metrics.width).toBe(66);
  });

  it("keeps a fixed block width while editing existing text", () => {
    const metrics = getInlineTextEditorMetrics({
      text: "A note that wraps",
      fontSize: 24,
      width: 140,
      viewportZoom: 1,
      measureTextWidth: () => 300,
      measureTextHeight: () => 62.4,
    });

    expect(metrics.width).toBe(140);
    expect(metrics.height).toBe(62.4);
  });

  it("uses wrapped fallback height for a fixed block width", () => {
    const metrics = getInlineTextEditorMetrics({
      text: "one two three four",
      fontSize: 24,
      width: 80,
      viewportZoom: 1,
    });

    expect(metrics.height).toBeGreaterThan(24 * 1.3);
  });

  it("does not cap long single-line editor width", () => {
    const metrics = getInlineTextEditorMetrics({
      text: "123456789123456789123456789123456789",
      fontSize: 24,
      viewportZoom: 1,
    });

    expect(metrics.width).toBeGreaterThan(460);
  });
});
