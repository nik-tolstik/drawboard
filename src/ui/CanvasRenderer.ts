import type {
  ArrowElement,
  BrushElement,
  DrawingElement,
  SceneSnapshot,
  ShapeElement,
  TextElement,
  Viewport,
} from "../domain/elements";
import { getArrowHead, getDiamondPoints, normalizeRect, type Rect } from "../domain/geometry";
import { getElementBounds, getElementsInLayerOrder } from "../domain/selection";

export type CanvasRenderOptions = {
  preview?: DrawingElement;
  previews?: DrawingElement[];
  hiddenElementIds?: Set<string>;
  selectedElementIds?: Set<string>;
  selectionBox?: Rect;
};

const GRID_SIZE = 24;
const CANVAS_BACKGROUND = "#fbfbfa";
const GRID_COLOR = "rgba(26, 26, 26, 0.075)";
const TEXT_CONTENT_INSET_X = 3;
const TEXT_CONTENT_INSET_Y = 4;
const TEXT_LINE_HEIGHT = 1.3;

export class CanvasRenderer {
  private context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private pixelRatio = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas 2D context is not available.");
    }

    this.context = context;
  }

  resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    this.pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    this.width = Math.floor(width);
    this.height = Math.floor(height);
    this.canvas.width = Math.floor(width * this.pixelRatio);
    this.canvas.height = Math.floor(height * this.pixelRatio);
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
  }

  render(scene: SceneSnapshot, options: CanvasRenderOptions = {}): void {
    this.clear();
    this.drawGrid(scene.viewport);

    this.context.save();
    this.applyViewport(scene.viewport);

    const renderedElements: DrawingElement[] = [];

    for (const element of getElementsInLayerOrder(scene.elements)) {
      if (options.hiddenElementIds?.has(element.id)) {
        continue;
      }

      this.drawElement(element);
      renderedElements.push(element);
    }

    if (options.preview) {
      this.drawElement(options.preview);
      renderedElements.push(options.preview);
    }

    for (const preview of options.previews ?? []) {
      this.drawElement(preview);
      renderedElements.push(preview);
    }

    if (options.selectedElementIds && options.selectedElementIds.size > 0) {
      this.drawSelectedElements(renderedElements, options.selectedElementIds);
    }

    if (options.selectionBox) {
      this.drawSelectionBox(options.selectionBox);
    }

    this.context.restore();
  }

  private clear(): void {
    this.context.save();
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.context.fillStyle = CANVAS_BACKGROUND;
    this.context.fillRect(0, 0, this.width, this.height);
    this.context.restore();
  }

  private drawGrid(viewport: Viewport): void {
    const scaledGrid = GRID_SIZE * viewport.zoom;
    const offsetX = viewport.x % scaledGrid;
    const offsetY = viewport.y % scaledGrid;

    this.context.save();
    this.context.strokeStyle = GRID_COLOR;
    this.context.lineWidth = 1;
    this.context.beginPath();

    for (let x = offsetX; x < this.width; x += scaledGrid) {
      this.context.moveTo(x, 0);
      this.context.lineTo(x, this.height);
    }

    for (let y = offsetY; y < this.height; y += scaledGrid) {
      this.context.moveTo(0, y);
      this.context.lineTo(this.width, y);
    }

    this.context.stroke();
    this.context.restore();
  }

  private applyViewport(viewport: Viewport): void {
    this.context.translate(viewport.x, viewport.y);
    this.context.scale(viewport.zoom, viewport.zoom);
  }

  private drawElement(element: DrawingElement): void {
    this.context.save();
    this.context.strokeStyle = element.style.stroke;
    this.context.fillStyle = element.style.fill;
    this.context.lineWidth = element.style.lineWidth;
    this.context.lineJoin = "round";
    this.context.lineCap = "round";

    if (element.type === "brush") {
      this.drawBrush(element);
    } else if (element.type === "text") {
      this.drawText(element);
    } else if (element.type === "arrow") {
      this.drawArrow(element);
    } else {
      this.drawShape(element);
    }

    this.context.restore();
  }

  private drawBrush(element: BrushElement): void {
    const [firstPoint, ...points] = element.points;

    if (!firstPoint) {
      return;
    }

    this.context.beginPath();
    this.context.moveTo(firstPoint.x, firstPoint.y);

    for (const point of points) {
      this.context.lineTo(point.x, point.y);
    }

    this.context.stroke();
  }

  private drawText(element: TextElement): void {
    this.context.font = `${element.fontSize}px "Virgil", "Comic Sans MS", "Segoe Print", sans-serif`;
    this.context.textBaseline = "top";
    this.context.fillStyle = element.style.stroke;

    const lines = element.text.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      this.context.fillText(
        lines[index] ?? "",
        element.x + TEXT_CONTENT_INSET_X,
        element.y + TEXT_CONTENT_INSET_Y + index * element.fontSize * TEXT_LINE_HEIGHT,
      );
    }
  }

  private drawShape(element: ShapeElement): void {
    const rect = normalizeRect({
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    });

    if (rect.width < 2 || rect.height < 2) {
      return;
    }

    if (element.type === "square") {
      this.context.fillRect(rect.x, rect.y, rect.width, rect.height);
      this.context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      return;
    }

    if (element.type === "circle") {
      this.context.beginPath();
      this.context.ellipse(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        rect.width / 2,
        rect.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      this.context.fill();
      this.context.stroke();
      return;
    }

    const [top, right, bottom, left] = getDiamondPoints(rect);

    if (!top || !right || !bottom || !left) {
      return;
    }

    this.context.beginPath();
    this.context.moveTo(top.x, top.y);
    this.context.lineTo(right.x, right.y);
    this.context.lineTo(bottom.x, bottom.y);
    this.context.lineTo(left.x, left.y);
    this.context.closePath();
    this.context.fill();
    this.context.stroke();
  }

  private drawArrow(element: ArrowElement): void {
    this.context.beginPath();
    this.context.moveTo(element.start.x, element.start.y);
    this.context.lineTo(element.end.x, element.end.y);
    this.context.stroke();

    const [left, right] = getArrowHead(element.start, element.end);

    if (!left || !right) {
      return;
    }

    this.context.beginPath();
    this.context.moveTo(left.x, left.y);
    this.context.lineTo(element.end.x, element.end.y);
    this.context.lineTo(right.x, right.y);
    this.context.stroke();
  }

  private drawSelectedElements(elements: DrawingElement[], selectedElementIds: Set<string>): void {
    this.context.save();
    this.context.strokeStyle = "rgba(75, 111, 255, 0.95)";
    this.context.lineWidth = 1.5;
    this.context.setLineDash([6, 4]);

    for (const element of elements) {
      if (!selectedElementIds.has(element.id)) {
        continue;
      }

      const bounds = normalizeRect(getElementBounds(element));
      this.context.strokeRect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12);
    }

    this.context.restore();
  }

  private drawSelectionBox(selectionBox: Rect): void {
    const rect = normalizeRect(selectionBox);

    this.context.save();
    this.context.strokeStyle = "rgba(75, 111, 255, 0.9)";
    this.context.fillStyle = "rgba(75, 111, 255, 0.08)";
    this.context.lineWidth = 1.5;
    this.context.setLineDash([6, 5]);
    this.context.beginPath();
    this.context.rect(rect.x, rect.y, rect.width, rect.height);
    this.context.fill();
    this.context.stroke();
    this.context.restore();
  }
}
