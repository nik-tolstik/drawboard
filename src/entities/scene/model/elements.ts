export type DrawingElementType = "brush" | "text" | "rectangle" | "diamond" | "ellipse" | "arrow";
export type Tool = "pan" | "select" | DrawingElementType;
export type TextAlign = "left" | "center" | "right";
export const BORDER_RADIUS_VALUES = [0, 4, 8, 16] as const;
export type BorderRadius = (typeof BORDER_RADIUS_VALUES)[number];

export type Point = {
  x: number;
  y: number;
};

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export type ElementStyle = {
  borderRadius: BorderRadius;
  stroke: string;
  fill: string;
  lineWidth: number;
  opacity: number;
  roughness: number;
};

export type BaseElement = {
  id: string;
  type: DrawingElementType;
  layer: number;
  createdAt: number;
  updatedAt: number;
  style: ElementStyle;
};

export type BrushElement = BaseElement & {
  type: "brush";
  points: Point[];
};

export type TextElement = BaseElement & {
  type: "text";
  x: number;
  y: number;
  text: string;
  textAlign: TextAlign;
  fontSize: number;
  width: number;
  height: number;
};

export type ShapeElement = BaseElement & {
  type: "rectangle" | "diamond" | "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ArrowElement = BaseElement & {
  type: "arrow";
  points: Point[];
};

export type DrawingElement = BrushElement | TextElement | ShapeElement | ArrowElement;

export type SceneSnapshot = {
  version: 2;
  elements: DrawingElement[];
  viewport: Viewport;
  updatedAt: number;
};

export const DEFAULT_STYLE: ElementStyle = {
  borderRadius: 0,
  stroke: "#171717",
  fill: "rgba(255, 255, 255, 0)",
  lineWidth: 2,
  opacity: 1,
  roughness: 0.55,
};

export const DEFAULT_VIEWPORT: Viewport = {
  x: 0,
  y: 0,
  zoom: 1,
};

export const DEFAULT_LAYER = 0;
export const MIN_ARROW_POINTS = 3;
export const DEFAULT_TEXT_ALIGN: TextAlign = "left";
export const DEFAULT_TEXT_FONT_SIZE = 24;
export const TEXT_CONTENT_INSET_X = 3;
export const TEXT_CONTENT_INSET_Y = 5;
export const TEXT_LINE_HEIGHT = 1.3;
export const TEXT_MIN_WIDTH = 120;
export const TEXT_WIDTH_RATIO = 0.62;
export const TEXT_WIDTH_PADDING = 14;
export const MIN_TEXT_WIDTH = 24;
export const MIN_TEXT_FONT_SIZE = 8;

export type TextMeasure = (text: string, fontSize: number) => number;

const estimateTextWidth: TextMeasure = (text, fontSize) =>
  Array.from(text).length * fontSize * TEXT_WIDTH_RATIO;

export const getTextElementWidth = (text: string, fontSize = DEFAULT_TEXT_FONT_SIZE): number => {
  const longestLineLength = Math.max(1, ...text.split("\n").map((line) => line.length));

  return Math.max(
    TEXT_MIN_WIDTH,
    longestLineLength * fontSize * TEXT_WIDTH_RATIO + TEXT_WIDTH_PADDING,
  );
};

const splitTokenToFit = (
  token: string,
  availableWidth: number,
  fontSize: number,
  measureText: TextMeasure,
): string[] => {
  const characters = Array.from(token);
  const chunks: string[] = [];
  let chunk = "";

  for (const character of characters) {
    const candidate = chunk + character;

    if (chunk && measureText(candidate, fontSize) > availableWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }

  if (chunk || chunks.length === 0) {
    chunks.push(chunk);
  }

  return chunks;
};

const wrapParagraph = (
  paragraph: string,
  availableWidth: number,
  fontSize: number,
  measureText: TextMeasure,
): string[] => {
  const tokens = paragraph.match(/\s+|\S+/gu) ?? [];

  if (tokens.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let line = "";

  for (const token of tokens) {
    const candidate = line + token;

    if (measureText(candidate, fontSize) <= availableWidth) {
      line = candidate;
      continue;
    }

    if (/^\s+$/u.test(token) && line) {
      lines.push(line);
      line = "";
      continue;
    }

    if (line) {
      lines.push(line);
      line = "";
    }

    if (measureText(token, fontSize) <= availableWidth) {
      line = token;
      continue;
    }

    const chunks = splitTokenToFit(token, availableWidth, fontSize, measureText);
    lines.push(...chunks.slice(0, -1));
    line = chunks.at(-1) ?? "";
  }

  if (line || lines.length === 0) {
    lines.push(line);
  }

  return lines;
};

export const getWrappedTextLines = (
  text: string,
  width: number,
  fontSize = DEFAULT_TEXT_FONT_SIZE,
  measureText: TextMeasure = estimateTextWidth,
): string[] => {
  const availableWidth = Math.max(1, width - TEXT_CONTENT_INSET_X * 2);

  return text
    .split("\n")
    .flatMap((paragraph) => wrapParagraph(paragraph, availableWidth, fontSize, measureText));
};

export const getTextElementHeight = (
  text: string,
  fontSize = DEFAULT_TEXT_FONT_SIZE,
  width?: number,
  measureText?: TextMeasure,
): number => {
  const lineCount =
    width === undefined
      ? text.split("\n").length
      : getWrappedTextLines(text, width, fontSize, measureText).length;

  return lineCount * fontSize * TEXT_LINE_HEIGHT;
};

export const createElementId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `element-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const now = (): number => Date.now();

export const createBrushElement = (point: Point, layer = DEFAULT_LAYER): BrushElement => {
  const timestamp = now();

  return {
    id: createElementId(),
    type: "brush",
    layer,
    points: [point],
    createdAt: timestamp,
    updatedAt: timestamp,
    style: { ...DEFAULT_STYLE, lineWidth: 2.25 },
  };
};

export const createTextElement = (
  point: Point,
  text: string,
  layer = DEFAULT_LAYER,
): TextElement => {
  const timestamp = now();

  return {
    id: createElementId(),
    type: "text",
    layer,
    x: point.x,
    y: point.y,
    text,
    textAlign: DEFAULT_TEXT_ALIGN,
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    width: getTextElementWidth(text),
    height: getTextElementHeight(text),
    createdAt: timestamp,
    updatedAt: timestamp,
    style: { ...DEFAULT_STYLE },
  };
};

export const updateTextElementText = (element: TextElement, text: string): TextElement => ({
  ...element,
  text,
  height: getTextElementHeight(text, element.fontSize, element.width),
  updatedAt: now(),
});

export const updateArrowPoint = (
  element: ArrowElement,
  pointIndex: number,
  point: Point,
): ArrowElement => ({
  ...element,
  points: element.points.map((currentPoint, index) =>
    index === pointIndex ? point : currentPoint,
  ),
  updatedAt: now(),
});

export const createShapeElement = (
  type: ShapeElement["type"],
  origin: Point,
  target: Point,
  layer = DEFAULT_LAYER,
): ShapeElement => {
  const timestamp = now();

  return {
    id: createElementId(),
    type,
    layer,
    x: origin.x,
    y: origin.y,
    width: target.x - origin.x,
    height: target.y - origin.y,
    createdAt: timestamp,
    updatedAt: timestamp,
    style: { ...DEFAULT_STYLE, lineWidth: 2 },
  };
};

export const createArrowElement = (points: Point[], layer = DEFAULT_LAYER): ArrowElement => {
  const timestamp = now();

  return {
    id: createElementId(),
    type: "arrow",
    layer,
    points: points.map((point) => ({ ...point })),
    createdAt: timestamp,
    updatedAt: timestamp,
    style: { ...DEFAULT_STYLE, lineWidth: 2.2 },
  };
};
