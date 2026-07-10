import {
  BORDER_RADIUS_VALUES,
  DEFAULT_STYLE,
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_LAYER,
  DEFAULT_VIEWPORT,
  MIN_TEXT_WIDTH,
  MIN_ARROW_POINTS,
  getTextElementHeight,
  getTextElementWidth,
  type DrawingElement,
  type BorderRadius,
  type ElementStyle,
  type Point,
  type SceneSnapshot,
  type TextAlign,
} from "./elements";
import { clampViewportZoom } from "./geometry";

const finiteOrDefault = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const positiveOrDefault = (value: unknown, fallback: number): number => {
  const numberValue = finiteOrDefault(value, fallback);

  return numberValue > 0 ? numberValue : fallback;
};

const stringOrDefault = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const textAlignOrDefault = (value: unknown): TextAlign =>
  value === "center" || value === "right" ? value : DEFAULT_TEXT_ALIGN;

const borderRadiusOrDefault = (value: unknown): BorderRadius =>
  BORDER_RADIUS_VALUES.includes(value as BorderRadius)
    ? (value as BorderRadius)
    : DEFAULT_STYLE.borderRadius;

const normalizeStyle = (value: unknown): ElementStyle => {
  const style = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    borderRadius: borderRadiusOrDefault(style.borderRadius),
    stroke: stringOrDefault(style.stroke, DEFAULT_STYLE.stroke),
    fill: stringOrDefault(style.fill, DEFAULT_STYLE.fill),
    lineWidth: positiveOrDefault(style.lineWidth, DEFAULT_STYLE.lineWidth),
    opacity: clamp(finiteOrDefault(style.opacity, DEFAULT_STYLE.opacity), 0, 1),
    roughness: finiteOrDefault(style.roughness, DEFAULT_STYLE.roughness),
  };
};

const pointOrDefault = (value: unknown, fallback: Point): Point => {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Record<string, unknown>;

  return {
    x: finiteOrDefault(record.x, fallback.x),
    y: finiteOrDefault(record.y, fallback.y),
  };
};

const normalizeArrowPoints = (element: Record<string, unknown>): Point[] => {
  const rawPoints = element.points;

  if (Array.isArray(rawPoints) && rawPoints.length > 0) {
    const points = rawPoints.map((point, index) =>
      pointOrDefault(
        point,
        index > 0 ? pointOrDefault(rawPoints[index - 1], { x: 0, y: 0 }) : { x: 0, y: 0 },
      ),
    );

    return ensureMinimumArrowPoints(points);
  }

  return ensureMinimumArrowPoints([]);
};

const ensureMinimumArrowPoints = (points: Point[]): Point[] => {
  if (points.length >= MIN_ARROW_POINTS) {
    return points;
  }

  if (points.length === 2) {
    const [start, end] = points;

    if (start && end) {
      return [start, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, end];
    }
  }

  const fallback = points[0] ?? { x: 0, y: 0 };

  return Array.from({ length: MIN_ARROW_POINTS }, () => ({ ...fallback }));
};

const normalizeElement = (
  element: DrawingElement | Record<string, unknown>,
  layerFallback: number,
): DrawingElement => {
  if (element.type === "arrow") {
    const arrow = element as Record<string, unknown>;

    return {
      ...arrow,
      points: normalizeArrowPoints(arrow),
      style: normalizeStyle(arrow.style),
      layer: finiteOrDefault(arrow.layer, layerFallback),
    } as DrawingElement;
  }

  if (element.type === "text") {
    const textElement = element as Record<string, unknown>;
    const text = typeof textElement.text === "string" ? textElement.text : "";
    const fontSize = positiveOrDefault(textElement.fontSize, DEFAULT_TEXT_FONT_SIZE);
    const naturalWidth = getTextElementWidth(text, fontSize);
    const width = Math.max(MIN_TEXT_WIDTH, positiveOrDefault(textElement.width, naturalWidth));
    const computedHeight = getTextElementHeight(text, fontSize, width);
    const height = positiveOrDefault(textElement.height, computedHeight);

    return {
      ...textElement,
      text,
      textAlign: textAlignOrDefault(textElement.textAlign),
      fontSize,
      width,
      height,
      style: normalizeStyle(textElement.style),
      layer: finiteOrDefault(textElement.layer, layerFallback),
    } as DrawingElement;
  }

  const elementRecord = element as Record<string, unknown>;

  return {
    ...elementRecord,
    style: normalizeStyle(elementRecord.style),
    layer: finiteOrDefault(elementRecord.layer, layerFallback),
  } as DrawingElement;
};

const normalizeElements = (elements: Array<DrawingElement | Record<string, unknown>>) => {
  let nextLayer = DEFAULT_LAYER;

  return elements.map((element) => {
    const normalizedElement = normalizeElement(element, nextLayer);
    nextLayer = Math.max(nextLayer, normalizedElement.layer + 1);

    return normalizedElement;
  });
};

export const createEmptyScene = (): SceneSnapshot => ({
  version: 2,
  elements: [],
  viewport: { ...DEFAULT_VIEWPORT },
  updatedAt: Date.now(),
});

export const normalizeScene = (
  scene: Partial<SceneSnapshot> | Record<string, unknown> | null | undefined,
): SceneSnapshot => {
  if (!scene || scene.version !== 2 || !Array.isArray(scene.elements)) {
    return createEmptyScene();
  }

  const viewport = scene.viewport;
  const normalizedViewport =
    viewport && typeof viewport === "object" ? (viewport as Record<string, unknown>) : undefined;

  return {
    version: 2,
    elements: normalizeElements(scene.elements as Array<Record<string, unknown>>),
    viewport: {
      x: finiteOrDefault(normalizedViewport?.x, DEFAULT_VIEWPORT.x),
      y: finiteOrDefault(normalizedViewport?.y, DEFAULT_VIEWPORT.y),
      zoom: clampViewportZoom(finiteOrDefault(normalizedViewport?.zoom, DEFAULT_VIEWPORT.zoom)),
    },
    updatedAt: finiteOrDefault(scene.updatedAt, Date.now()),
  };
};
