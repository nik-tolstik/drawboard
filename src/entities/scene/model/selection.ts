import {
  createElementId,
  type ArrowElement,
  type BrushElement,
  type DrawingElement,
  type ElementStyle,
  type Point,
  type ShapeElement,
  type TextElement,
} from "./elements";
import {
  distance,
  distanceToSegment,
  getArrowHead,
  getArrowHeadSegment,
  getArrowCurveBounds,
  getArrowCurvePoints,
  getRoundedContourPoints,
  getRoundedShapeContour,
  normalizeRect,
  type Rect,
} from "./geometry";

export const getElementsInLayerOrder = (elements: DrawingElement[]): DrawingElement[] =>
  elements
    .map((element, index) => ({ element, index }))
    .sort(
      (first, second) => first.element.layer - second.element.layer || first.index - second.index,
    )
    .map(({ element }) => element);

export const getElementBounds = (element: DrawingElement): Rect => {
  if (element.type === "brush") {
    return getPointsBounds(element.points);
  }

  if (element.type === "text") {
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };
  }

  if (element.type === "arrow") {
    const curveBounds = getArrowCurveBounds(element.points);
    const arrowHeadSegment = getArrowHeadSegment(element.points);
    const arrowHead = arrowHeadSegment ? getArrowHead(...arrowHeadSegment) : [];

    return getPointsBounds([
      { x: curveBounds.x, y: curveBounds.y },
      { x: curveBounds.x + curveBounds.width, y: curveBounds.y + curveBounds.height },
      ...arrowHead,
    ]);
  }

  return normalizeRect(element);
};

export const getElementsBounds = (elements: DrawingElement[]): Rect | undefined => {
  if (elements.length === 0) {
    return undefined;
  }

  const bounds = elements.map(getElementBounds).map(normalizeRect);
  const minX = Math.min(...bounds.map((rect) => rect.x));
  const minY = Math.min(...bounds.map((rect) => rect.y));
  const maxX = Math.max(...bounds.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...bounds.map((rect) => rect.y + rect.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

export const isElementHit = (element: DrawingElement, point: Point, tolerance = 6): boolean => {
  if (element.type === "brush") {
    return isPolylineHit(element.points, point, tolerance);
  }

  if (element.type === "text") {
    return isPointNearRect(point, getElementBounds(element), tolerance);
  }

  if (element.type === "arrow") {
    return isArrowHit(element, point, tolerance);
  }

  if (element.type === "ellipse") {
    return isEllipseHit(element, point, tolerance);
  }

  if (element.type === "diamond") {
    return isDiamondHit(element, point, tolerance);
  }

  return isRectangleHit(element, point, tolerance);
};

export const getElementAtPoint = (
  elements: DrawingElement[],
  point: Point,
  tolerance = 6,
): DrawingElement | undefined => {
  const layeredElements = getElementsInLayerOrder(elements);

  for (let index = layeredElements.length - 1; index >= 0; index -= 1) {
    const element = layeredElements[index];

    if (element && isElementHit(element, point, tolerance)) {
      return element;
    }
  }

  return undefined;
};

export const getElementsIntersectingRect = (
  elements: DrawingElement[],
  selectionRect: Rect,
): DrawingElement[] => {
  const normalizedSelection = normalizeRect(selectionRect);

  return elements.filter((element) =>
    rectsIntersect(getElementBounds(element), normalizedSelection),
  );
};

export const translateElement = (element: DrawingElement, delta: Point): DrawingElement => {
  const timestamp = Date.now();

  if (element.type === "brush") {
    return {
      ...element,
      points: element.points.map((point) => translatePoint(point, delta)),
      updatedAt: timestamp,
    } satisfies BrushElement;
  }

  if (element.type === "text") {
    return {
      ...element,
      x: element.x + delta.x,
      y: element.y + delta.y,
      updatedAt: timestamp,
    } satisfies TextElement;
  }

  if (element.type === "arrow") {
    return {
      ...element,
      points: element.points.map((point) => translatePoint(point, delta)),
      updatedAt: timestamp,
    } satisfies ArrowElement;
  }

  return {
    ...element,
    x: element.x + delta.x,
    y: element.y + delta.y,
    updatedAt: timestamp,
  } satisfies ShapeElement;
};

export const cloneElementsAt = (elements: DrawingElement[], target: Point): DrawingElement[] => {
  const bounds = getElementsBounds(elements);

  if (!bounds) {
    return [];
  }

  const delta = {
    x: target.x - bounds.x,
    y: target.y - bounds.y,
  };

  return elements.map((element) => ({
    ...translateElement(structuredClone(element), delta),
    id: createElementId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
};

export const applyElementStyle = (
  element: DrawingElement,
  stylePatch: Partial<ElementStyle>,
): DrawingElement => ({
  ...element,
  style: {
    ...element.style,
    ...stylePatch,
  },
  updatedAt: Date.now(),
});

const translatePoint = (point: Point, delta: Point): Point => ({
  x: point.x + delta.x,
  y: point.y + delta.y,
});

const getPointsBounds = (points: Point[]): Rect => {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const isPointNearRect = (point: Point, rect: Rect, tolerance: number): boolean => {
  const normalized = normalizeRect(rect);
  const dx = Math.max(normalized.x - point.x, 0, point.x - (normalized.x + normalized.width));
  const dy = Math.max(normalized.y - point.y, 0, point.y - (normalized.y + normalized.height));

  return Math.hypot(dx, dy) <= tolerance;
};

const rectsIntersect = (first: Rect, second: Rect): boolean => {
  const a = normalizeRect(first);
  const b = normalizeRect(second);

  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
};

const isPolylineHit = (points: Point[], point: Point, tolerance: number): boolean => {
  if (points.some((candidate) => distance(candidate, point) <= tolerance)) {
    return true;
  }

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];

    if (start && end && distanceToSegment(point, start, end) <= tolerance) {
      return true;
    }
  }

  return false;
};

const isArrowHit = (element: ArrowElement, point: Point, tolerance: number): boolean => {
  const arrowHeadSegment = getArrowHeadSegment(element.points);
  const arrowHead = arrowHeadSegment ? getArrowHead(...arrowHeadSegment) : [];
  const [, arrowEnd] = arrowHeadSegment ?? [];

  return (
    isPolylineHit(getArrowCurvePoints(element.points), point, tolerance) ||
    isPolylineHit(
      [arrowHead[0], arrowEnd, arrowHead[1]].filter((candidate): candidate is Point =>
        Boolean(candidate),
      ),
      point,
      tolerance,
    )
  );
};

const isRectangleHit = (element: ShapeElement, point: Point, tolerance: number): boolean =>
  isRoundedShapeHit("rectangle", element, point, tolerance, hasVisibleFill(element.style.fill));

const isEllipseHit = (element: ShapeElement, point: Point, tolerance: number): boolean => {
  const rect = normalizeRect(element);
  const rx = rect.width / 2;
  const ry = rect.height / 2;

  if (rx === 0 || ry === 0) {
    return false;
  }

  const center = { x: rect.x + rx, y: rect.y + ry };
  const normalizedDistance = ((point.x - center.x) / rx) ** 2 + ((point.y - center.y) / ry) ** 2;
  const edgeDistance = Math.abs(Math.sqrt(normalizedDistance) - 1) * Math.min(rx, ry);

  return normalizedDistance <= 1 || edgeDistance <= tolerance;
};

const hasVisibleFill = (fill: string): boolean => {
  const normalized = fill.trim().toLowerCase();

  if (!normalized || normalized === "transparent" || normalized === "none") {
    return false;
  }

  const rgbaMatch = normalized.match(/^rgba?\((.*)\)$/);

  if (rgbaMatch) {
    const body = rgbaMatch[1] ?? "";
    const slashAlpha = body.split("/")[1]?.trim();

    if (slashAlpha) {
      return parseAlpha(slashAlpha) > 0;
    }

    const parts = body.split(",").map((part) => part.trim());

    if (normalized.startsWith("rgba") && parts[3]) {
      return parseAlpha(parts[3]) > 0;
    }

    return true;
  }

  const hexMatch = normalized.match(/^#([0-9a-f]{4}|[0-9a-f]{8})$/);

  if (hexMatch) {
    const value = hexMatch[1] ?? "";
    const alpha = value.length === 4 ? value[3] + value[3] : value.slice(6, 8);

    return Number.parseInt(alpha, 16) > 0;
  }

  return true;
};

const parseAlpha = (value: string): number => {
  const alpha = Number.parseFloat(value);

  if (!Number.isFinite(alpha)) {
    return 1;
  }

  return value.endsWith("%") ? alpha / 100 : alpha;
};

const isDiamondHit = (element: ShapeElement, point: Point, tolerance: number): boolean => {
  return isRoundedShapeHit("diamond", element, point, tolerance, true);
};

const isRoundedShapeHit = (
  type: "rectangle" | "diamond",
  element: ShapeElement,
  point: Point,
  tolerance: number,
  includeInterior: boolean,
): boolean => {
  const contour = getRoundedShapeContour(type, element, element.style.borderRadius ?? 0);
  const polygon = getRoundedContourPoints(contour);
  const firstPoint = polygon[0];

  return (
    Boolean(firstPoint) &&
    ((includeInterior && isPointInPolygon(point, polygon)) ||
      isPolylineHit([...polygon, firstPoint], point, tolerance))
  );
};

const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
  let inside = false;

  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index];
    const previous = polygon[previousIndex];

    if (!current || !previous) {
      continue;
    }

    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};
