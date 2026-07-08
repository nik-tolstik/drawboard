import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWPORT } from "./elements";
import { createEmptyScene, normalizeScene } from "./scene";

describe("scene", () => {
  it("creates an empty v1 scene", () => {
    const scene = createEmptyScene();

    expect(scene.version).toBe(1);
    expect(scene.elements).toEqual([]);
    expect(scene.viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it("falls back to an empty scene for invalid data", () => {
    expect(normalizeScene(null).elements).toEqual([]);
    expect(normalizeScene({ version: 99 } as never).viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it("repairs missing viewport values", () => {
    expect(
      normalizeScene({
        version: 1,
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

  it("migrates old rectangle and ellipse element types", () => {
    const scene = normalizeScene({
      version: 1,
      elements: [
        { id: "1", type: "rectangle" },
        { id: "2", type: "ellipse" },
      ] as never,
      viewport: DEFAULT_VIEWPORT,
      updatedAt: Date.now(),
    });

    expect(scene.elements.map((element) => element.type)).toEqual(["square", "circle"]);
  });

  it("adds layers to old persisted elements", () => {
    const scene = normalizeScene({
      version: 1,
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
});
