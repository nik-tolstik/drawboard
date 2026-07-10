import {
  DEFAULT_TEXT_FONT_SIZE,
  TEXT_CONTENT_INSET_X,
  TEXT_LINE_HEIGHT,
  getTextElementHeight,
  getWrappedTextLines,
  type TextMeasure,
} from "@/entities/scene";

export type TextLayout = {
  lines: string[];
  height: number;
};

export const getCanvasTextFont = (fontSize = DEFAULT_TEXT_FONT_SIZE): string =>
  `${fontSize}px "Virgil", "Comic Sans MS", "Segoe Print", sans-serif`;

export const measureTextElementWidth = (
  context: CanvasRenderingContext2D,
  text: string,
  fontSize = DEFAULT_TEXT_FONT_SIZE,
): number => {
  const lines = text.split("\n");

  context.save();
  context.font = getCanvasTextFont(fontSize);

  const longestLineWidth = Math.max(0, ...lines.map((line) => context.measureText(line).width));

  context.restore();

  return longestLineWidth + TEXT_CONTENT_INSET_X * 2;
};

const withCanvasTextMeasurer = <Result>(
  context: CanvasRenderingContext2D,
  fontSize: number,
  measure: (measureText: TextMeasure) => Result,
): Result => {
  context.save();
  context.font = getCanvasTextFont(fontSize);

  try {
    return measure((text) => context.measureText(text).width);
  } finally {
    context.restore();
  }
};

export const measureTextElementLayout = (
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
  fontSize = DEFAULT_TEXT_FONT_SIZE,
): TextLayout => {
  const lines = withCanvasTextMeasurer(context, fontSize, (measureText) =>
    getWrappedTextLines(text, width, fontSize, measureText),
  );

  return {
    lines,
    height: lines.length * fontSize * TEXT_LINE_HEIGHT,
  };
};

export const measureTextElementHeight = (
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
  fontSize = DEFAULT_TEXT_FONT_SIZE,
): number =>
  withCanvasTextMeasurer(context, fontSize, (measureText) =>
    getTextElementHeight(text, fontSize, width, measureText),
  );
