import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWPORT, getTextElementHeight, getTextElementWidth } from "./elements";
import { MAX_VIEWPORT_ZOOM, MIN_VIEWPORT_ZOOM } from "./geometry";
import { createEmptyScene, normalizeScene } from "./scene";

describe("scene", () => {
  it("creates an empty v2 scene", () => {
    const scene = createEmptyScene();

    expect(scene.version).toBe(2);
    expect(scene.elements).toEqual([]);
    expect(scene.viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it("falls back to an empty scene for invalid data", () => {
    expect(normalizeScene(null).elements).toEqual([]);
    expect(normalizeScene({ version: 99 } as never).viewport).toEqual(DEFAULT_VIEWPORT);
    expect(normalizeScene({ version: 1, elements: [{ type: "rectangle" }] }).elements).toEqual([]);
  });

  it("repairs missing viewport values", () => {
    expect(
      normalizeScene({
        version: 2,
        elements: [],
        viewport: { x: Number.NaN, y: 12, zoom: Number.NaN },
        updatedAt: Number.NaN,
      }).viewport,
    ).toEqual({
      x: DEFAULT_VIEWPORT.x,
      y: 12,
      zoom: DEFAULT_VIEWPORT.zoom,
    });
  });

  it("clamps persisted viewport zoom values", () => {
    expect(
      normalizeScene({
        version: 2,
        elements: [],
        viewport: { x: 0, y: 0, zoom: 0 },
      }).viewport.zoom,
    ).toBe(MIN_VIEWPORT_ZOOM);
    expect(
      normalizeScene({
        version: 2,
        elements: [],
        viewport: { x: 0, y: 0, zoom: 10 },
      }).viewport.zoom,
    ).toBe(MAX_VIEWPORT_ZOOM);
  });

  it("repairs missing element layers", () => {
    const scene = normalizeScene({
      version: 2,
      elements: [
        { id: "1", type: "text" },
        { id: "2", type: "text", layer: 8 },
        { id: "3", type: "text" },
      ] as never,
      viewport: DEFAULT_VIEWPORT,
      updatedAt: Date.now(),
    });

    expect(scene.elements.map((element) => element.layer)).toEqual([0, 8, 9]);
  });

  it("repairs missing styles and text alignment", () => {
    const scene = normalizeScene({
      version: 2,
      elements: [
        {
          id: "1",
          type: "text",
          textAlign: "diagonal",
          style: { opacity: 1.8, lineWidth: -4 },
        },
        {
          id: "2",
          type: "rectangle",
          style: { opacity: -0.2 },
        },
      ] as never,
      viewport: DEFAULT_VIEWPORT,
      updatedAt: Date.now(),
    });

    const [text, rectangle] = scene.elements;

    expect(text?.style.opacity).toBe(1);
    expect(text?.style.lineWidth).toBe(2);
    expect(text?.style.borderRadius).toBe(0);
    expect(text?.type === "text" ? text.textAlign : undefined).toBe("left");
    expect(rectangle?.style.opacity).toBe(0);
  });

  it("normalizes persisted border radius presets", () => {
    const scene = normalizeScene({
      version: 2,
      elements: [
        { id: "1", type: "rectangle", style: { borderRadius: 16 } },
        { id: "2", type: "diamond", style: { borderRadius: 12 } },
        { id: "3", type: "rectangle", style: { borderRadius: -4 } },
      ] as never,
      viewport: DEFAULT_VIEWPORT,
      updatedAt: Date.now(),
    });

    expect(scene.elements.map((element) => element.style.borderRadius)).toEqual([16, 0, 0]);
  });

  it("preserves user-sized text dimensions", () => {
    const scene = normalizeScene({
      version: 2,
      elements: [
        {
          id: "1",
          type: "text",
          text: "one two three",
          fontSize: 24,
          width: 72,
          height: 124.8,
        },
      ] as never,
      viewport: DEFAULT_VIEWPORT,
      updatedAt: Date.now(),
    });
    const [element] = scene.elements;

    expect(element?.type === "text" ? element.width : undefined).toBe(72);
    expect(element?.type === "text" ? element.height : undefined).toBe(124.8);
  });

  it("repairs invalid text dimensions", () => {
    const scene = normalizeScene({
      version: 2,
      elements: [
        {
          id: "1",
          type: "text",
          text: "one two three",
          fontSize: 24,
          width: -10,
          height: Number.NaN,
        },
      ] as never,
      viewport: DEFAULT_VIEWPORT,
      updatedAt: Date.now(),
    });
    const [element] = scene.elements;

    expect(element?.type === "text" ? element.width : undefined).toBe(
      getTextElementWidth("one two three"),
    );
    expect(element?.type === "text" ? element.height : undefined).toBe(
      getTextElementHeight("one two three", 24, getTextElementWidth("one two three")),
    );
  });

  it("keeps persisted arrows at the minimum of three points", () => {
    const scene = normalizeScene({
      version: 2,
      elements: [
        {
          id: "1",
          type: "arrow",
          points: [
            { x: 10, y: 20 },
            { x: 50, y: 60 },
          ],
        },
      ] as never,
      viewport: DEFAULT_VIEWPORT,
      updatedAt: Date.now(),
    });
    const [arrow] = scene.elements;

    expect(arrow?.type === "arrow" ? arrow.points : undefined).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ]);
  });
});
