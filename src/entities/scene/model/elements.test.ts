import { describe, expect, it } from "vitest";
import {
  createArrowElement,
  createShapeElement,
  createTextElement,
  getTextElementHeight,
  getTextElementWidth,
  getWrappedTextLines,
  TEXT_LINE_HEIGHT,
  updateTextElementText,
} from "./elements";

describe("elements", () => {
  it("keeps long uninterrupted text at its natural width", () => {
    expect(getTextElementWidth("123456789123456789123456789123456789")).toBeGreaterThan(460);
  });

  it("updates text content while preserving element identity", () => {
    const element = createTextElement({ x: 10, y: 20 }, "old");
    const updated = updateTextElementText(element, "new content");

    expect(updated.id).toBe(element.id);
    expect(updated.text).toBe("new content");
    expect(updated.x).toBe(10);
    expect(updated.y).toBe(20);
    expect(updated.width).toBe(element.width);
    expect(updated.height).toBe(
      getTextElementHeight("new content", element.fontSize, element.width),
    );
    expect(updated.updatedAt).toBeGreaterThanOrEqual(element.updatedAt);
  });

  it("estimates multiline text width from the longest line", () => {
    expect(getTextElementWidth("short\nlonger line")).toBe(getTextElementWidth("longer line"));
  });

  it("keeps text bounds height to line-height content", () => {
    expect(getTextElementHeight("Nikita", 24)).toBeCloseTo(24 * TEXT_LINE_HEIGHT, 4);
  });

  it("wraps by words while preserving hard line breaks", () => {
    const measureText = (text: string): number => Array.from(text).length * 10;

    expect(getWrappedTextLines("one two\nsix", 36, 24, measureText)).toEqual(["one", "two", "six"]);
  });

  it("preserves whitespace when it fits inside a wrapped line", () => {
    const measureText = (text: string): number => Array.from(text).length * 10;

    expect(getWrappedTextLines("one   two", 96, 24, measureText)).toEqual(["one   two"]);
  });

  it("breaks words that cannot fit on a line", () => {
    const measureText = (text: string): number => Array.from(text).length * 10;

    expect(getWrappedTextLines("abcdefgh", 36, 24, measureText)).toEqual(["abc", "def", "gh"]);
  });

  it("creates arrows with draggable points", () => {
    const arrow = createArrowElement([
      { x: 10, y: 20 },
      { x: 30, y: 30 },
      { x: 50, y: 40 },
      { x: 70, y: 35 },
    ]);

    expect(arrow.points).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 30 },
      { x: 50, y: 40 },
      { x: 70, y: 35 },
    ]);
  });

  it("creates shapes without rounded corners by default", () => {
    const rectangle = createShapeElement("rectangle", { x: 0, y: 0 }, { x: 80, y: 40 });
    const diamond = createShapeElement("diamond", { x: 0, y: 0 }, { x: 80, y: 40 });

    expect(rectangle.style.borderRadius).toBe(0);
    expect(diamond.style.borderRadius).toBe(0);
  });
});
