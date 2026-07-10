import {
  MIN_TEXT_FONT_SIZE,
  MIN_TEXT_WIDTH,
  getTextElementHeight,
  type DrawingElement,
  type Point,
  type ShapeElement,
  type TextElement,
  type TextMeasure,
} from "./elements";
import { normalizeRect, type Rect } from "./geometry";

export const MIN_SHAPE_SIZE = 6;

export const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];
export type ResizableElement = ShapeElement | TextElement;

export type ResizeElementOptions = {
  preserveAspectRatio?: boolean;
  measureText?: TextMeasure;
};

type HorizontalDirection = "w" | "e" | undefined;
type VerticalDirection = "n" | "s" | undefined;

const getHorizontalDirection = (handle: ResizeHandle): HorizontalDirection => {
  if (handle.includes("w")) {
    return "w";
  }

  return handle.includes("e") ? "e" : undefined;
};

const getVerticalDirection = (handle: ResizeHandle): VerticalDirection => {
  if (handle.includes("n")) {
    return "n";
  }

  return handle.includes("s") ? "s" : undefined;
};

export const getResizeHandlePoints = (rect: Rect): Record<ResizeHandle, Point> => {
  const normalized = normalizeRect(rect);
  const left = normalized.x;
  const top = normalized.y;
  const right = normalized.x + normalized.width;
  const bottom = normalized.y + normalized.height;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;

  return {
    nw: { x: left, y: top },
    n: { x: centerX, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: centerY },
    se: { x: right, y: bottom },
    s: { x: centerX, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: centerY },
  };
};

export const getResizeHandleAtPoint = (
  rect: Rect,
  point: Point,
  tolerance = 6,
): ResizeHandle | undefined => {
  const hitTolerance = Math.max(0, tolerance);
  const handlePoints = getResizeHandlePoints(rect);

  return RESIZE_HANDLES.filter((handle) => {
    const handlePoint = handlePoints[handle];

    return (
      Math.abs(point.x - handlePoint.x) <= hitTolerance &&
      Math.abs(point.y - handlePoint.y) <= hitTolerance
    );
  }).sort((first, second) => {
    const firstPoint = handlePoints[first];
    const secondPoint = handlePoints[second];
    const firstDistance = Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y);
    const secondDistance = Math.hypot(point.x - secondPoint.x, point.y - secondPoint.y);

    return firstDistance - secondDistance;
  })[0];
};

export const isResizableElement = (element: DrawingElement): element is ResizableElement =>
  element.type === "text" ||
  element.type === "rectangle" ||
  element.type === "diamond" ||
  element.type === "ellipse";

const resizeAxis = (
  anchor: number,
  pointer: number,
  direction: "negative" | "positive",
  minimum: number,
): { position: number; size: number } => {
  if (direction === "negative") {
    const position = Math.min(pointer, anchor - minimum);

    return { position, size: anchor - position };
  }

  return {
    position: anchor,
    size: Math.max(minimum, pointer - anchor),
  };
};

const getOppositeAnchor = (
  rect: Rect,
  horizontal: HorizontalDirection,
  vertical: VerticalDirection,
): Point => ({
  x:
    horizontal === "w"
      ? rect.x + rect.width
      : horizontal === "e"
        ? rect.x
        : rect.x + rect.width / 2,
  y: vertical === "n" ? rect.y + rect.height : vertical === "s" ? rect.y : rect.y + rect.height / 2,
});

const resizeShape = (
  element: ShapeElement,
  handle: ResizeHandle,
  point: Point,
  preserveAspectRatio: boolean,
): ShapeElement => {
  const rect = normalizeRect(element);
  const horizontal = getHorizontalDirection(handle);
  const vertical = getVerticalDirection(handle);
  const anchor = getOppositeAnchor(rect, horizontal, vertical);

  if (horizontal && vertical && preserveAspectRatio) {
    const baseWidth = Math.max(MIN_SHAPE_SIZE, rect.width);
    const baseHeight = Math.max(MIN_SHAPE_SIZE, rect.height);
    const horizontalDelta = horizontal === "w" ? anchor.x - point.x : point.x - anchor.x;
    const verticalDelta = vertical === "n" ? anchor.y - point.y : point.y - anchor.y;
    const scale = Math.max(
      horizontalDelta / baseWidth,
      verticalDelta / baseHeight,
      MIN_SHAPE_SIZE / baseWidth,
      MIN_SHAPE_SIZE / baseHeight,
    );
    const width = baseWidth * scale;
    const height = baseHeight * scale;

    return {
      ...element,
      x: horizontal === "w" ? anchor.x - width : anchor.x,
      y: vertical === "n" ? anchor.y - height : anchor.y,
      width,
      height,
      updatedAt: Date.now(),
    };
  }

  const horizontalAxis = horizontal
    ? resizeAxis(anchor.x, point.x, horizontal === "w" ? "negative" : "positive", MIN_SHAPE_SIZE)
    : { position: rect.x, size: rect.width };
  const verticalAxis = vertical
    ? resizeAxis(anchor.y, point.y, vertical === "n" ? "negative" : "positive", MIN_SHAPE_SIZE)
    : { position: rect.y, size: rect.height };

  return {
    ...element,
    x: horizontalAxis.position,
    y: verticalAxis.position,
    width: horizontalAxis.size,
    height: verticalAxis.size,
    updatedAt: Date.now(),
  };
};

const getTextScale = (
  element: TextElement,
  handle: ResizeHandle,
  point: Point,
): { anchor: Point; scale: number } => {
  const rect = normalizeRect(element);
  const horizontal = getHorizontalDirection(handle);
  const vertical = getVerticalDirection(handle);
  const anchor = getOppositeAnchor(rect, horizontal, vertical);
  const minimumScale = Math.max(MIN_TEXT_FONT_SIZE / element.fontSize, MIN_TEXT_WIDTH / rect.width);
  const horizontalScale = horizontal
    ? (horizontal === "w" ? anchor.x - point.x : point.x - anchor.x) / rect.width
    : 0;
  const verticalScale = vertical
    ? (vertical === "n" ? anchor.y - point.y : point.y - anchor.y) / rect.height
    : 0;

  return {
    anchor,
    scale: Math.max(minimumScale, horizontalScale, verticalScale),
  };
};

const scaleText = (element: TextElement, handle: ResizeHandle, point: Point): TextElement => {
  const rect = normalizeRect(element);
  const horizontal = getHorizontalDirection(handle);
  const vertical = getVerticalDirection(handle);
  const { anchor, scale } = getTextScale(element, handle, point);
  const width = rect.width * scale;
  const height = rect.height * scale;
  const centerX = rect.x + rect.width / 2;

  return {
    ...element,
    x: horizontal ? (horizontal === "w" ? anchor.x - width : anchor.x) : centerX - width / 2,
    y: vertical === "n" ? anchor.y - height : anchor.y,
    width,
    height,
    fontSize: element.fontSize * scale,
    updatedAt: Date.now(),
  };
};

const resizeText = (
  element: TextElement,
  handle: ResizeHandle,
  point: Point,
  measureText?: TextMeasure,
): TextElement => {
  const horizontal = getHorizontalDirection(handle);
  const vertical = getVerticalDirection(handle);

  if (vertical) {
    return scaleText(element, handle, point);
  }

  if (!horizontal) {
    return element;
  }

  const rect = normalizeRect(element);
  const anchorX = horizontal === "w" ? rect.x + rect.width : rect.x;
  const horizontalAxis = resizeAxis(
    anchorX,
    point.x,
    horizontal === "w" ? "negative" : "positive",
    MIN_TEXT_WIDTH,
  );

  return {
    ...element,
    x: horizontalAxis.position,
    y: rect.y,
    width: horizontalAxis.size,
    height: getTextElementHeight(element.text, element.fontSize, horizontalAxis.size, measureText),
    updatedAt: Date.now(),
  };
};

export function resizeElement(
  element: TextElement,
  handle: ResizeHandle,
  point: Point,
  options?: ResizeElementOptions,
): TextElement;
export function resizeElement(
  element: ShapeElement,
  handle: ResizeHandle,
  point: Point,
  options?: ResizeElementOptions,
): ShapeElement;
export function resizeElement(
  element: ResizableElement,
  handle: ResizeHandle,
  point: Point,
  options?: ResizeElementOptions,
): ResizableElement;
export function resizeElement(
  element: ResizableElement,
  handle: ResizeHandle,
  point: Point,
  options: ResizeElementOptions = {},
): ResizableElement {
  return element.type === "text"
    ? resizeText(element, handle, point, options.measureText)
    : resizeShape(element, handle, point, options.preserveAspectRatio === true);
}
