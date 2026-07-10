import { describe, expect, it } from "vitest";

import { TEXT_LINE_HEIGHT } from "@/entities/scene";

import { measureTextElementHeight, measureTextElementLayout } from "./textMeasurement";

const createContext = (): CanvasRenderingContext2D =>
  ({
    font: "",
    measureText: (text: string) => ({ width: Array.from(text).length * 10 }),
    restore: () => undefined,
    save: () => undefined,
  }) as unknown as CanvasRenderingContext2D;

describe("canvas text measurement", () => {
  it("wraps at word boundaries inside the element width", () => {
    const layout = measureTextElementLayout(createContext(), "one two three", 76, 20);

    expect(layout.lines).toEqual(["one two", "three"]);
    expect(layout.height).toBe(2 * 20 * TEXT_LINE_HEIGHT);
  });

  it("splits words that are wider than the element", () => {
    expect(measureTextElementLayout(createContext(), "abcdefgh", 36, 20).lines).toEqual([
      "abc",
      "def",
      "gh",
    ]);
  });

  it("includes manual line breaks when measuring height", () => {
    const height = measureTextElementHeight(createContext(), "one\ntwo\n", 200, 24);

    expect(height).toBe(3 * 24 * TEXT_LINE_HEIGHT);
  });
});
