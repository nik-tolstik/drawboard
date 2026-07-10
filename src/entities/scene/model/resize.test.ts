import { describe, expect, it } from "vitest";
import { createBrushElement, createShapeElement, createTextElement } from "./elements";
import {
  RESIZE_HANDLES,
  getResizeHandleAtPoint,
  getResizeHandlePoints,
  isResizableElement,
  resizeElement,
  type ResizeHandle,
} from "./resize";

describe("resize", () => {
  it("positions and hit-tests all eight resize handles", () => {
    const points = getResizeHandlePoints({ x: 10, y: 20, width: 100, height: 80 });

    expect(points).toEqual({
      nw: { x: 10, y: 20 },
      n: { x: 60, y: 20 },
      ne: { x: 110, y: 20 },
      e: { x: 110, y: 60 },
      se: { x: 110, y: 100 },
      s: { x: 60, y: 100 },
      sw: { x: 10, y: 100 },
      w: { x: 10, y: 60 },
    });

    for (const handle of RESIZE_HANDLES) {
      expect(
        getResizeHandleAtPoint({ x: 10, y: 20, width: 100, height: 80 }, points[handle], 1),
      ).toBe(handle);
    }
  });

  it.each<[ResizeHandle, { x: number; y: number }, [number, number, number, number]]>([
    ["nw", { x: 0, y: 0 }, [0, 0, 110, 100]],
    ["n", { x: 60, y: 0 }, [10, 0, 100, 100]],
    ["ne", { x: 120, y: 0 }, [10, 0, 110, 100]],
    ["e", { x: 120, y: 60 }, [10, 20, 110, 80]],
    ["se", { x: 120, y: 110 }, [10, 20, 110, 90]],
    ["s", { x: 60, y: 110 }, [10, 20, 100, 90]],
    ["sw", { x: 0, y: 110 }, [0, 20, 110, 90]],
    ["w", { x: 0, y: 60 }, [0, 20, 110, 80]],
  ])("resizes a shape from the %s handle", (handle, point, expected) => {
    const shape = createShapeElement("rectangle", { x: 10, y: 20 }, { x: 110, y: 100 });
    const resized = resizeElement(shape, handle, point);

    expect([resized.x, resized.y, resized.width, resized.height]).toEqual(expected);
  });

  it("blocks shape handles from crossing their opposite anchor", () => {
    const shape = createShapeElement("ellipse", { x: 10, y: 20 }, { x: 110, y: 100 });
    const resized = resizeElement(shape, "w", { x: 200, y: 60 });

    expect(resized).toMatchObject({ x: 104, y: 20, width: 6, height: 80 });
  });

  it("normalizes a shape with negative dimensions while resizing", () => {
    const shape = createShapeElement("rectangle", { x: 110, y: 100 }, { x: 10, y: 20 });
    const resized = resizeElement(shape, "se", { x: 120, y: 110 });

    expect(resized).toMatchObject({ x: 10, y: 20, width: 110, height: 90 });
  });

  it("preserves a shape aspect ratio for corner resize", () => {
    const shape = createShapeElement("diamond", { x: 10, y: 20 }, { x: 110, y: 100 });
    const resized = resizeElement(shape, "nw", { x: -90, y: 0 }, { preserveAspectRatio: true });

    expect(resized).toMatchObject({ x: -90, y: -60, width: 200, height: 160 });
    expect(resized.x + resized.width).toBe(110);
    expect(resized.y + resized.height).toBe(100);
  });

  it("reflows text for horizontal resize without changing the font", () => {
    const text = {
      ...createTextElement({ x: 10, y: 20 }, "one two three"),
      width: 120,
      height: 31.2,
    };
    const measureText = (value: string): number => value.length * 10;
    const resized = resizeElement(text, "e", { x: 76, y: 35 }, { measureText });

    expect(resized).toMatchObject({ x: 10, y: 20, width: 66, fontSize: 24 });
    expect(resized.height).toBeCloseTo(93.6);
  });

  it("scales text vertically around its horizontal center", () => {
    const text = {
      ...createTextElement({ x: 10, y: 20 }, "text"),
      width: 120,
      height: 31.2,
    };
    const resized = resizeElement(text, "s", { x: 70, y: 82.4 });

    expect(resized.x).toBeCloseTo(-50);
    expect(resized.y).toBe(20);
    expect(resized.width).toBeCloseTo(240);
    expect(resized.height).toBeCloseTo(62.4);
    expect(resized.fontSize).toBeCloseTo(48);
  });

  it("scales text from a corner and enforces font and width minimums", () => {
    const text = {
      ...createTextElement({ x: 10, y: 20 }, "text"),
      width: 120,
      height: 31.2,
    };
    const resized = resizeElement(text, "nw", { x: 200, y: 200 });

    expect(resized.fontSize).toBe(8);
    expect(resized.width).toBe(40);
    expect(resized.height).toBeCloseTo(10.4);
    expect(resized.x + resized.width).toBe(130);
    expect(resized.y + resized.height).toBeCloseTo(51.2);
  });

  it("only enables resizing for shapes and text", () => {
    expect(isResizableElement(createTextElement({ x: 0, y: 0 }, "text"))).toBe(true);
    expect(
      isResizableElement(createShapeElement("rectangle", { x: 0, y: 0 }, { x: 10, y: 10 })),
    ).toBe(true);
    expect(isResizableElement(createBrushElement({ x: 0, y: 0 }))).toBe(false);
  });
});
