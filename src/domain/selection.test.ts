import { describe, expect, it } from "vitest";
import {
  createArrowElement,
  createBrushElement,
  createShapeElement,
  createTextElement,
} from "./elements";
import {
  cloneElementsAt,
  getElementAtPoint,
  getElementBounds,
  getElementsInLayerOrder,
  getElementsIntersectingRect,
} from "./selection";

describe("selection", () => {
  it("finds the latest element at a point when layers match", () => {
    const square = createShapeElement("square", { x: 0, y: 0 }, { x: 80, y: 80 });
    const text = createTextElement({ x: 10, y: 10 }, "note");

    expect(getElementAtPoint([square, text], { x: 20, y: 20 })?.id).toBe(text.id);
  });

  it("uses higher layers for hit-test priority", () => {
    const lowerText = { ...createTextElement({ x: 10, y: 10 }, "lower"), layer: 1 };
    const higherText = { ...createTextElement({ x: 10, y: 10 }, "higher"), layer: 5 };

    expect(getElementAtPoint([higherText, lowerText], { x: 20, y: 20 })?.id).toBe(higherText.id);
    expect(getElementsInLayerOrder([higherText, lowerText]).map((element) => element.id)).toEqual([
      lowerText.id,
      higherText.id,
    ]);
  });

  it("selects an unfilled square only by its border", () => {
    const square = createShapeElement("square", { x: 0, y: 0 }, { x: 80, y: 80 });

    expect(getElementAtPoint([square], { x: 40, y: 40 })).toBeUndefined();
    expect(getElementAtPoint([square], { x: 2, y: 40 })?.id).toBe(square.id);
  });

  it("selects a filled square by its full area", () => {
    const square = createShapeElement("square", { x: 0, y: 0 }, { x: 80, y: 80 });
    const filledSquare = {
      ...square,
      style: {
        ...square.style,
        fill: "#ffffff",
      },
    };

    expect(getElementAtPoint([filledSquare], { x: 40, y: 40 })?.id).toBe(square.id);
  });

  it("selects elements that intersect an area", () => {
    const square = createShapeElement("square", { x: 0, y: 0 }, { x: 80, y: 80 });
    const arrow = createArrowElement({ x: 160, y: 160 }, { x: 260, y: 160 });

    expect(
      getElementsIntersectingRect([square, arrow], { x: -10, y: -10, width: 120, height: 120 }).map(
        (element) => element.id,
      ),
    ).toEqual([square.id]);
  });

  it("clones selected elements to the target cursor position", () => {
    const brush = createBrushElement({ x: 10, y: 10 });
    brush.points = [
      { x: 10, y: 10 },
      { x: 30, y: 20 },
    ];

    const [clone] = cloneElementsAt([brush], { x: 100, y: 100 });

    expect(clone?.id).not.toBe(brush.id);
    expect(getElementBounds(clone!)).toEqual({ x: 100, y: 100, width: 20, height: 10 });
  });
});
