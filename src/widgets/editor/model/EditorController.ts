import {
  DEFAULT_TEXT_ALIGN,
  DEFAULT_STYLE,
  MIN_ARROW_POINTS,
  createArrowElement,
  createBrushElement,
  createShapeElement,
  createTextElement,
  getElementBounds,
  getResizeHandleAtPoint,
  getResizeHandlePoints,
  getTextElementHeight,
  getTextElementWidth,
  isResizableElement,
  resizeElement,
  updateArrowPoint,
  updateTextElementText,
  clampViewportZoom,
  type ArrowElement,
  type BorderRadius,
  type BrushElement,
  type DrawingElement,
  type ElementStyle,
  type Point,
  type ResizeHandle,
  type SceneSnapshot,
  type ShapeElement,
  type TextAlign,
  type TextElement,
  type Tool,
} from "@/entities/scene";
import {
  cloneElementsAt,
  constrainToSquareDelta,
  distance,
  getElementAtPoint,
  getElementsBounds,
  getElementsInLayerOrder,
  getElementsIntersectingRect,
  normalizeRect,
  screenToWorld,
  shouldAppendPoint,
  translateElement,
  worldToScreen,
  zoomViewportAtScreenPoint,
  ZOOM_STEP,
  type Rect,
} from "@/entities/scene";
import type { SceneStore } from "@/entities/scene";
import type { LayerOrderCommand } from "@/entities/scene";
import type { Viewport } from "@/entities/scene";
import type { CanvasRenderOptions } from "../lib/CanvasRenderer";
import {
  getCanvasTextFont,
  measureTextElementHeight,
  measureTextElementWidth,
} from "../lib/textMeasurement";
import { getObjectSettingsSnapshot, type ObjectSettingsSnapshot } from "./objectSettings";

type RenderPreview = (options?: CanvasRenderOptions) => void;
type TogglePanning = (isPanning: boolean) => void;
type SelectionChangeListener = () => void;
type ToolChangeListener = (tool: Tool) => void;
type TextEditorOptions = {
  initialText?: string;
  fontSize?: number;
  width?: number;
  textColor?: string;
  textAlign?: TextAlign;
  onCommit: (text: string) => void;
  onCancel?: () => void;
};

type SelectionDrag = {
  origin: Point;
  current: Point;
  additive: boolean;
  baseIds: Set<string>;
  dragged: boolean;
};

type MoveDrag = {
  origin: Point;
  current: Point;
  baseElements: DrawingElement[];
  dragged: boolean;
};

type ArrowPointDrag = {
  pointIndex: number;
  baseElement: ArrowElement;
  current: Point;
  dragged: boolean;
};

type ResizeDrag = {
  handle: ResizeHandle;
  baseElement: ShapeElement | TextElement;
  current: Point;
  dragged: boolean;
};

type ArrowCreateDrag = {
  origin: Point;
  current: Point;
  canDragCreate: boolean;
  dragged: boolean;
};

type PinchGesture = {
  pointerIds: [number, number];
  startDistance: number;
  startViewport: Viewport;
  startCenterWorld: Point;
};

const MIN_SHAPE_SIZE = 6;
const MIN_SELECTION_DRAG_DISTANCE = 4;
const DUPLICATE_OFFSET = 24;
const MIDDLE_MOUSE_BUTTON = 1;
const PRIMARY_MOUSE_BUTTON = 0;
const WHEEL_ZOOM_SPEED = 0.002;

export class EditorController {
  private activeTool: Tool = "select";
  private currentStyle: Partial<ElementStyle> = {
    borderRadius: DEFAULT_STYLE.borderRadius,
    stroke: DEFAULT_STYLE.stroke,
    fill: DEFAULT_STYLE.fill,
    lineWidth: DEFAULT_STYLE.lineWidth,
    opacity: DEFAULT_STYLE.opacity,
  };
  private currentTextAlign: TextAlign = DEFAULT_TEXT_ALIGN;
  private draft: DrawingElement | undefined;
  private isPanning = false;
  private selectionDrag: SelectionDrag | undefined;
  private moveDrag: MoveDrag | undefined;
  private resizeDrag: ResizeDrag | undefined;
  private arrowPointDrag: ArrowPointDrag | undefined;
  private arrowCreateDrag: ArrowCreateDrag | undefined;
  private arrowDraftPoints: Point[] | undefined;
  private selectedElementIds = new Set<string>();
  private editingTextElementId: string | undefined;
  private clipboard: DrawingElement[] = [];
  private lastCursorWorldPoint: Point | undefined;
  private panStart: Point | undefined;
  private panViewportStart: Point | undefined;
  private pointerId: number | undefined;
  private activeTouchPointers = new Map<number, Point>();
  private pinchGesture: PinchGesture | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly store: SceneStore,
    private readonly renderPreview: RenderPreview,
    private readonly togglePanning: TogglePanning,
    private readonly openTextEditor: (screenPoint: Point, options: TextEditorOptions) => void,
    private readonly onSelectionChange: SelectionChangeListener = () => {},
    private readonly onToolChange: ToolChangeListener = () => {},
  ) {
    this.bind();
    this.canvas.dataset.tool = this.activeTool;
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.canvas.removeEventListener("dblclick", this.handleDoubleClick);
    this.canvas.removeEventListener("contextmenu", this.handleContextMenu);

    if (this.pointerId !== undefined) {
      this.releasePointer(this.pointerId);
    }

    for (const pointerId of this.activeTouchPointers.keys()) {
      this.releasePointer(pointerId);
    }

    this.activeTouchPointers.clear();
  }

  setTool(tool: Tool): void {
    if (tool !== "arrow") {
      this.cancelArrowDraft();
    }

    if (this.activeTool === tool) {
      this.canvas.style.cursor = "";
      this.renderSelection();
      return;
    }

    this.activeTool = tool;
    this.canvas.style.cursor = "";
    this.canvas.dataset.tool = tool;
    this.onToolChange(tool);
    this.renderSelection();
  }

  getTool(): Tool {
    return this.activeTool;
  }

  getObjectSettings(): ObjectSettingsSnapshot {
    return getObjectSettingsSnapshot({
      currentStyle: this.currentStyle,
      currentTextAlign: this.currentTextAlign,
      selectedElements: this.getSelectedElements(),
    });
  }

  setStyle(stylePatch: Partial<ElementStyle>): void {
    this.currentStyle = {
      ...this.currentStyle,
      ...stylePatch,
    };
    this.store.updateElementsStyle(this.selectedElementIds, stylePatch);
    this.renderSelection();
  }

  setBorderRadius(borderRadius: BorderRadius): void {
    this.currentStyle = {
      ...this.currentStyle,
      borderRadius,
    };
    const borderRadiusElementIds = new Set(
      this.getSelectedElements()
        .filter((element) => element.type === "rectangle" || element.type === "diamond")
        .map((element) => element.id),
    );

    this.store.updateElementsStyle(borderRadiusElementIds, { borderRadius });
    this.renderSelection();
  }

  setTextAlign(textAlign: TextAlign): void {
    this.currentTextAlign = textAlign;
    this.store.updateTextElementsAlign(this.selectedElementIds, textAlign);
    this.renderSelection();
  }

  copySelection(): boolean {
    const selectedElements = this.getSelectedElements();

    if (selectedElements.length === 0) {
      return false;
    }

    this.clipboard = selectedElements.map((element) => structuredClone(element));
    return true;
  }

  pasteSelection(): boolean {
    if (this.clipboard.length === 0) {
      return false;
    }

    const pastedElements = cloneElementsAt(this.clipboard, this.getPasteTarget());

    if (pastedElements.length === 0) {
      return false;
    }

    this.store.addElements(pastedElements);
    this.selectedElementIds = new Set(pastedElements.map((element) => element.id));
    this.renderSelection();

    return true;
  }

  duplicateSelection(): boolean {
    const selectedElements = this.getSelectedElements();

    if (selectedElements.length === 0) {
      return false;
    }

    this.clipboard = selectedElements.map((element) => structuredClone(element));
    const bounds = getElementsBounds(selectedElements);
    const duplicateTarget = bounds
      ? { x: bounds.x + DUPLICATE_OFFSET, y: bounds.y + DUPLICATE_OFFSET }
      : this.getPasteTarget();
    const duplicatedElements = cloneElementsAt(this.clipboard, duplicateTarget);

    if (duplicatedElements.length === 0) {
      return false;
    }

    this.store.addElements(duplicatedElements);
    this.selectedElementIds = new Set(duplicatedElements.map((element) => element.id));
    this.renderSelection();

    return true;
  }

  deleteSelection(): boolean {
    if (this.selectedElementIds.size === 0) {
      return false;
    }

    this.store.removeElements(new Set(this.selectedElementIds));
    this.selectedElementIds = new Set<string>();
    this.renderSelection();

    return true;
  }

  selectAll(): boolean {
    const elementIds = this.store.getSnapshot().elements.map((element) => element.id);

    this.draft = undefined;
    this.selectionDrag = undefined;
    this.moveDrag = undefined;
    this.resizeDrag = undefined;
    this.arrowPointDrag = undefined;
    this.arrowCreateDrag = undefined;
    this.selectedElementIds = new Set(elementIds);
    this.setTool("select");

    return elementIds.length > 0;
  }

  getSelectedElementIds(): Set<string> {
    return new Set(this.selectedElementIds);
  }

  updateSelectionLayer(command: LayerOrderCommand): boolean {
    const didUpdate = this.store.updateElementsLayer(this.selectedElementIds, command);

    if (didUpdate) {
      this.renderSelection();
    }

    return didUpdate;
  }

  refreshSelection(scene: SceneSnapshot = this.store.getSnapshot()): void {
    const existingElementIds = new Set(scene.elements.map((element) => element.id));
    this.selectedElementIds = new Set(
      [...this.selectedElementIds].filter((elementId) => existingElementIds.has(elementId)),
    );
    this.renderSelection();
  }

  exportPng(): void {
    const link = document.createElement("a");
    link.download = `sketchboard-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }

  zoomIn(): void {
    this.zoomAtCanvasCenter(ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomAtCanvasCenter(1 / ZOOM_STEP);
  }

  resetZoom(): void {
    this.updateViewportZoomAt(this.getCanvasCenterPoint(), 1);
  }

  private bind(): void {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerUp);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    this.canvas.addEventListener("dblclick", this.handleDoubleClick);
    this.canvas.addEventListener("contextmenu", this.handleContextMenu);
  }

  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private handlePointerDown = (event: PointerEvent): void => {
    this.canvas.setPointerCapture(event.pointerId);

    if (event.pointerType === "touch") {
      this.handleTouchPointerDown(event);
      return;
    }

    this.pointerId = event.pointerId;
    this.startPointerInteraction(event);
  };

  private startPointerInteraction(event: PointerEvent): void {
    if (event.button === MIDDLE_MOUSE_BUTTON) {
      this.startPan(event);
      return;
    }

    if (event.button !== PRIMARY_MOUSE_BUTTON) {
      return;
    }

    if (this.activeTool === "pan") {
      this.startPan(event);
      return;
    }

    const screenPoint = this.getScreenPoint(event);
    const worldPoint = this.getWorldPoint(event);

    if (this.activeTool === "text") {
      this.openTextEditor(screenPoint, {
        textAlign: this.currentTextAlign,
        onCommit: (text) => {
          if (text.trim().length > 0) {
            const draftElement = {
              ...createTextElement(worldPoint, text),
              textAlign: this.currentTextAlign,
            };
            const width = this.measureTextWidth(text, draftElement.fontSize);
            const element = this.applyCurrentStyle({
              ...draftElement,
              width,
              height: this.measureTextHeight(text, width, draftElement.fontSize),
            });
            this.store.addElement(element);
            this.selectedElementIds = new Set([element.id]);
            this.switchToSelectAfterElementCreation();
          }
        },
      });
      return;
    }

    if (this.activeTool === "select") {
      this.startSelectInteraction(event, worldPoint);
      return;
    }

    if (this.activeTool === "arrow") {
      this.startArrowCreateInteraction(worldPoint);
      return;
    }

    this.clearSelection();
    this.draft = this.createDraft(worldPoint);
    this.renderCurrent({ preview: this.draft });
  }

  private handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      this.handleTouchPointerMove(event);
      return;
    }

    this.continuePointerMove(event);
  };

  private continuePointerMove(event: PointerEvent): void {
    const worldPoint = this.getWorldPoint(event);

    if (this.pointerId === undefined) {
      if (this.activeTool === "select") {
        this.updateResizeCursor(worldPoint);
      }

      if (this.arrowDraftPoints) {
        this.updateArrowDraftPreview(worldPoint);
      }

      return;
    }

    if (this.pointerId !== event.pointerId) {
      return;
    }

    if (this.isPanning) {
      this.updatePan(event);
      return;
    }

    if (this.arrowCreateDrag) {
      this.updateArrowCreateInteraction(worldPoint);
      return;
    }

    if (this.arrowPointDrag) {
      this.updateArrowPointDrag(worldPoint);
      return;
    }

    if (this.resizeDrag) {
      this.updateResize(worldPoint, event.shiftKey);
      return;
    }

    if (this.moveDrag) {
      this.updateMove(worldPoint);
      return;
    }

    if (this.selectionDrag) {
      this.updateSelection(worldPoint);
      return;
    }

    if (!this.draft) {
      return;
    }

    this.draft = this.updateDraft(this.draft, worldPoint, event.shiftKey);
    this.renderCurrent({ preview: this.draft });
  }

  private handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      this.handleTouchPointerUp(event);
      return;
    }

    this.continuePointerUp(event);
  };

  private continuePointerUp(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) {
      return;
    }

    if (this.isPanning) {
      this.endPan(event);
      return;
    }

    if (this.arrowPointDrag) {
      this.endArrowPointDrag(event);
      return;
    }

    if (this.resizeDrag) {
      this.endResize(event);
      return;
    }

    if (this.moveDrag) {
      this.endMove(event);
      return;
    }

    if (this.selectionDrag) {
      this.endSelection(event);
      return;
    }

    if (this.arrowCreateDrag) {
      this.endArrowCreateInteraction(event);
      return;
    }

    const worldPoint = this.getWorldPoint(event);
    const draft = this.draft ? this.updateDraft(this.draft, worldPoint, event.shiftKey) : undefined;
    const createdElement =
      draft && this.isDrawableDraft(draft) ? structuredClone(draft) : undefined;

    if (createdElement) {
      this.store.addElement(createdElement);
    }

    this.draft = undefined;
    this.pointerId = undefined;
    this.releasePointer(event.pointerId);

    if (
      createdElement?.type === "rectangle" ||
      createdElement?.type === "diamond" ||
      createdElement?.type === "ellipse"
    ) {
      this.switchToSelectAfterElementCreation();
      return;
    }

    this.renderSelection();
  }

  private handleWheel = (event: WheelEvent): void => {
    const delta = this.getNormalizedWheelDelta(event);

    if (delta.x === 0 && delta.y === 0) {
      return;
    }

    event.preventDefault();

    if (!event.ctrlKey && !event.metaKey) {
      this.panByWheelDelta(delta);
      return;
    }

    const viewport = this.store.getSnapshot().viewport;
    const zoomDelta = delta.y !== 0 ? delta.y : delta.x;
    const nextZoom = viewport.zoom * Math.exp(-zoomDelta * WHEEL_ZOOM_SPEED);

    this.updateViewportZoomAt(this.getScreenPoint(event), nextZoom);
  };

  private handleTouchPointerDown(event: PointerEvent): void {
    event.preventDefault();
    this.activeTouchPointers.set(event.pointerId, this.getScreenPoint(event));

    if (this.activeTouchPointers.size >= 2) {
      this.startPinchGesture();
      return;
    }

    this.pointerId = event.pointerId;
    this.startPointerInteraction(event);
  }

  private handleTouchPointerMove(event: PointerEvent): void {
    if (!this.activeTouchPointers.has(event.pointerId)) {
      return;
    }

    event.preventDefault();
    this.activeTouchPointers.set(event.pointerId, this.getScreenPoint(event));

    if (this.pinchGesture) {
      this.updatePinchGesture();
      return;
    }

    this.continuePointerMove(event);
  }

  private handleTouchPointerUp(event: PointerEvent): void {
    const wasTracked = this.activeTouchPointers.delete(event.pointerId);

    if (this.pinchGesture) {
      event.preventDefault();
      this.releasePointer(event.pointerId);

      if (!this.getPinchPointerPoints(this.pinchGesture)) {
        this.pinchGesture = undefined;
        this.renderSelection();
      }

      return;
    }

    if (!wasTracked) {
      return;
    }

    this.continuePointerUp(event);
  }

  private startPinchGesture(): void {
    const pointers = [...this.activeTouchPointers.entries()];
    const firstPointer = pointers[0];
    const secondPointer = pointers[1];

    if (!firstPointer || !secondPointer) {
      return;
    }

    const [firstPointerId, firstPoint] = firstPointer;
    const [secondPointerId, secondPoint] = secondPointer;

    const snapshotViewport = this.store.getSnapshot().viewport;
    const startViewport = {
      ...snapshotViewport,
      zoom: clampViewportZoom(snapshotViewport.zoom),
    };
    const startCenter = this.getCenterPoint(firstPoint, secondPoint);

    this.cancelActivePointerInteraction();
    this.pinchGesture = {
      pointerIds: [firstPointerId, secondPointerId],
      startDistance: Math.max(distance(firstPoint, secondPoint), 1),
      startViewport,
      startCenterWorld: screenToWorld(startCenter, startViewport),
    };
    this.lastCursorWorldPoint = this.pinchGesture.startCenterWorld;
  }

  private updatePinchGesture(): void {
    const gesture = this.pinchGesture;

    if (!gesture) {
      return;
    }

    const points = this.getPinchPointerPoints(gesture);

    if (!points) {
      return;
    }

    const [firstPoint, secondPoint] = points;
    const currentDistance = Math.max(distance(firstPoint, secondPoint), 1);
    const currentCenter = this.getCenterPoint(firstPoint, secondPoint);
    const nextZoom = clampViewportZoom(
      gesture.startViewport.zoom * (currentDistance / gesture.startDistance),
    );
    const nextViewport = {
      x: currentCenter.x - gesture.startCenterWorld.x * nextZoom,
      y: currentCenter.y - gesture.startCenterWorld.y * nextZoom,
      zoom: nextZoom,
    };

    this.lastCursorWorldPoint = screenToWorld(currentCenter, nextViewport);
    this.updateViewportIfChanged(nextViewport);
  }

  private getPinchPointerPoints(gesture: PinchGesture): [Point, Point] | undefined {
    const [firstPointerId, secondPointerId] = gesture.pointerIds;
    const firstPoint = this.activeTouchPointers.get(firstPointerId);
    const secondPoint = this.activeTouchPointers.get(secondPointerId);

    return firstPoint && secondPoint ? [firstPoint, secondPoint] : undefined;
  }

  private handleDoubleClick = (event: MouseEvent): void => {
    if (event.button !== PRIMARY_MOUSE_BUTTON) {
      return;
    }

    const worldPoint = this.getWorldPoint(event);
    const textElement = this.getTextElementAtPoint(worldPoint);

    if (!textElement) {
      return;
    }

    event.preventDefault();
    this.draft = undefined;
    this.selectionDrag = undefined;
    this.moveDrag = undefined;
    this.resizeDrag = undefined;
    this.arrowPointDrag = undefined;
    this.arrowCreateDrag = undefined;
    this.arrowDraftPoints = undefined;
    this.pointerId = undefined;
    this.selectedElementIds = new Set([textElement.id]);
    this.renderSelection();

    this.openTextEditor(this.getElementScreenPoint(textElement), {
      initialText: textElement.text,
      fontSize: textElement.fontSize,
      width: textElement.width,
      textColor: textElement.style.stroke,
      textAlign: textElement.textAlign,
      onCommit: (text) => this.commitTextElementEdit(textElement, text),
      onCancel: () => this.finishTextElementEdit(textElement.id),
    });
    this.editingTextElementId = textElement.id;
    this.renderSelection();
  };

  private createDraft(point: Point): DrawingElement {
    const tool = this.activeTool;

    if (tool === "brush") {
      return this.applyCurrentStyle(createBrushElement(point));
    }

    if (tool === "rectangle" || tool === "diamond" || tool === "ellipse") {
      return this.applyCurrentStyle(createShapeElement(tool, point, point));
    }

    throw new Error("Only drawing tools create drafts.");
  }

  private updateDraft(
    draft: DrawingElement,
    point: Point,
    shouldConstrainShape = false,
  ): DrawingElement {
    if (draft.type === "brush") {
      return this.updateBrush(draft, point);
    }

    if (draft.type === "rectangle" || draft.type === "diamond" || draft.type === "ellipse") {
      const width = point.x - draft.x;
      const height = point.y - draft.y;
      const shouldConstrain =
        (draft.type === "rectangle" || draft.type === "ellipse") && shouldConstrainShape;
      const constrained = shouldConstrain
        ? constrainToSquareDelta(width, height)
        : { width, height };

      return {
        ...draft,
        width: constrained.width,
        height: constrained.height,
        updatedAt: Date.now(),
      } satisfies ShapeElement;
    }

    return draft;
  }

  private updateBrush(draft: BrushElement, point: Point): BrushElement {
    if (!shouldAppendPoint(draft.points, point)) {
      return draft;
    }

    return {
      ...draft,
      points: [...draft.points, point],
      updatedAt: Date.now(),
    };
  }

  private startArrowCreateInteraction(point: Point): void {
    this.clearSelection();
    this.arrowCreateDrag = {
      origin: point,
      current: point,
      canDragCreate: this.arrowDraftPoints === undefined,
      dragged: false,
    };
    this.setArrowDraftPreview(
      this.arrowDraftPoints ? [...this.arrowDraftPoints, point] : [point, point],
    );
  }

  private updateArrowCreateInteraction(point: Point): void {
    if (!this.arrowCreateDrag) {
      return;
    }

    this.arrowCreateDrag.current = point;

    if (this.arrowCreateDrag.canDragCreate) {
      this.arrowCreateDrag.dragged =
        this.arrowCreateDrag.dragged ||
        distance(point, this.arrowCreateDrag.origin) >= MIN_SELECTION_DRAG_DISTANCE;

      if (this.arrowCreateDrag.dragged) {
        this.setArrowDraftPreview(
          this.getDragCreateArrowPoints(this.arrowCreateDrag.origin, point),
        );
        return;
      }
    }

    if (this.arrowDraftPoints) {
      this.updateArrowDraftPreview(point);
    }
  }

  private endArrowCreateInteraction(event: PointerEvent): void {
    const arrowCreateDrag = this.arrowCreateDrag;

    if (!arrowCreateDrag) {
      return;
    }

    this.arrowCreateDrag = undefined;

    if (arrowCreateDrag.dragged && arrowCreateDrag.canDragCreate) {
      const didCommit = this.commitArrowPoints(
        this.getDragCreateArrowPoints(arrowCreateDrag.origin, arrowCreateDrag.current),
      );

      if (!didCommit) {
        this.cancelArrowDraft();
        this.renderSelection();
      }
    } else {
      this.handleArrowClick(arrowCreateDrag.current);
    }

    this.pointerId = undefined;
    this.releasePointer(event.pointerId);
  }

  private handleArrowClick(point: Point): void {
    const confirmedPoints = this.arrowDraftPoints;

    if (!confirmedPoints) {
      this.arrowDraftPoints = [point];
      this.updateArrowDraftPreview(point);
      return;
    }

    const lastPoint = confirmedPoints.at(-1);
    const finishTolerance = 8 / this.store.getSnapshot().viewport.zoom;

    if (
      lastPoint &&
      confirmedPoints.length >= MIN_ARROW_POINTS &&
      distance(point, lastPoint) <= finishTolerance
    ) {
      this.commitArrowPoints(confirmedPoints);
      return;
    }

    if (lastPoint && distance(point, lastPoint) < 2 / this.store.getSnapshot().viewport.zoom) {
      this.updateArrowDraftPreview(point);
      return;
    }

    this.arrowDraftPoints = [...confirmedPoints, point];
    this.updateArrowDraftPreview(point);
  }

  private updateArrowDraftPreview(point: Point): void {
    if (!this.arrowDraftPoints) {
      return;
    }

    this.setArrowDraftPreview([...this.arrowDraftPoints, point]);
  }

  private setArrowDraftPreview(points: Point[]): void {
    const nextPoints = points.map((point) => ({ ...point }));

    if (this.draft?.type === "arrow") {
      this.draft = {
        ...this.draft,
        points: nextPoints,
        updatedAt: Date.now(),
      } satisfies ArrowElement;
    } else {
      this.draft = this.applyCurrentStyle(createArrowElement(nextPoints));
    }

    this.renderCurrent({ preview: this.draft });
  }

  private commitArrowPoints(points: Point[]): boolean {
    if (!this.isDrawableArrowPoints(points)) {
      return false;
    }

    const element = this.applyCurrentStyle(createArrowElement(points));
    this.store.addElement(element);
    this.selectedElementIds = new Set([element.id]);
    this.cancelArrowDraft();
    this.switchToSelectAfterElementCreation();

    return true;
  }

  private cancelArrowDraft(): void {
    if (this.draft?.type === "arrow") {
      this.draft = undefined;
    }

    this.arrowCreateDrag = undefined;
    this.arrowDraftPoints = undefined;
  }

  private getDragCreateArrowPoints(origin: Point, target: Point): Point[] {
    return [
      origin,
      {
        x: (origin.x + target.x) / 2,
        y: (origin.y + target.y) / 2,
      },
      target,
    ];
  }

  private isDrawableArrowPoints(points: Point[]): boolean {
    if (points.length < MIN_ARROW_POINTS) {
      return false;
    }

    let totalLength = 0;

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];

      if (previous && current) {
        totalLength += distance(previous, current);
      }
    }

    return totalLength >= MIN_SHAPE_SIZE;
  }

  private switchToSelectAfterElementCreation(): void {
    this.setTool("select");
  }

  private startSelectInteraction(event: PointerEvent, point: Point): void {
    if (this.startResizeIfPossible(point)) {
      return;
    }

    if (!event.shiftKey && this.startArrowPointDragIfPossible(point)) {
      return;
    }

    if (!event.shiftKey && this.startMoveIfPossible(point)) {
      return;
    }

    this.startSelection(event, point);
  }

  private startResizeIfPossible(point: Point): boolean {
    const [element] = this.getSelectedElements();

    if (this.selectedElementIds.size !== 1 || !element || !isResizableElement(element)) {
      return false;
    }

    const zoom = this.store.getSnapshot().viewport.zoom;
    const handle = getResizeHandleAtPoint(getElementBounds(element), point, 10 / zoom);

    if (!handle) {
      return false;
    }

    this.resizeDrag = {
      handle,
      baseElement: element,
      current: point,
      dragged: false,
    };
    this.setResizeCursor(handle);
    this.renderSelection();

    return true;
  }

  private startArrowPointDragIfPossible(point: Point): boolean {
    const snapshot = this.store.getSnapshot();
    const tolerance = 8 / snapshot.viewport.zoom;
    const selectedArrows = getElementsInLayerOrder(snapshot.elements).filter(
      (element): element is ArrowElement =>
        element.type === "arrow" && this.selectedElementIds.has(element.id),
    );

    for (let index = selectedArrows.length - 1; index >= 0; index -= 1) {
      const arrow = selectedArrows[index];

      if (!arrow) {
        continue;
      }

      const pointIndex = this.getArrowPointIndexAt(arrow, point, tolerance);

      if (pointIndex === undefined) {
        continue;
      }

      this.arrowPointDrag = {
        pointIndex,
        baseElement: arrow,
        current: point,
        dragged: false,
      };
      this.renderSelection();

      return true;
    }

    return false;
  }

  private getArrowPointIndexAt(
    element: ArrowElement,
    point: Point,
    tolerance: number,
  ): number | undefined {
    const hits = element.points
      .map((candidate, pointIndex) => ({
        pointIndex,
        distance: distance(candidate, point),
      }))
      .filter((hit) => hit.distance <= tolerance)
      .sort((first, second) => first.distance - second.distance);

    return hits[0]?.pointIndex;
  }

  private startMoveIfPossible(point: Point): boolean {
    const snapshot = this.store.getSnapshot();
    const tolerance = 8 / snapshot.viewport.zoom;
    const hitElement = getElementAtPoint(snapshot.elements, point, tolerance);

    if (!hitElement) {
      return false;
    }

    if (!this.selectedElementIds.has(hitElement.id)) {
      this.selectedElementIds = new Set([hitElement.id]);
    }

    const baseElements = this.getSelectedElements();

    if (baseElements.length === 0) {
      return false;
    }

    this.moveDrag = {
      origin: point,
      current: point,
      baseElements,
      dragged: false,
    };
    this.renderSelection();

    return true;
  }

  private startSelection(event: PointerEvent, point: Point): void {
    this.selectionDrag = {
      origin: point,
      current: point,
      additive: event.shiftKey,
      baseIds: new Set(this.selectedElementIds),
      dragged: false,
    };
    this.renderSelection();
  }

  private updateMove(point: Point): void {
    if (!this.moveDrag) {
      return;
    }

    this.moveDrag.current = point;
    this.moveDrag.dragged =
      this.moveDrag.dragged ||
      Math.hypot(point.x - this.moveDrag.origin.x, point.y - this.moveDrag.origin.y) >=
        MIN_SELECTION_DRAG_DISTANCE;

    if (!this.moveDrag.dragged) {
      return;
    }

    this.renderCurrent({
      hiddenElementIds: this.selectedElementIds,
      previews: this.getMovedElements(this.moveDrag),
    });
  }

  private updateArrowPointDrag(point: Point): void {
    if (!this.arrowPointDrag) {
      return;
    }

    const basePoint = this.arrowPointDrag.baseElement.points[this.arrowPointDrag.pointIndex];

    if (!basePoint) {
      return;
    }

    this.arrowPointDrag.current = point;
    this.arrowPointDrag.dragged =
      this.arrowPointDrag.dragged || distance(point, basePoint) >= MIN_SELECTION_DRAG_DISTANCE;

    if (!this.arrowPointDrag.dragged) {
      return;
    }

    const preview = this.getDraggedArrowPointElement(this.arrowPointDrag);

    this.renderCurrent({
      hiddenElementIds: new Set([preview.id]),
      preview,
    });
  }

  private updateResize(point: Point, preserveAspectRatio: boolean): void {
    const resizeDrag = this.resizeDrag;

    if (!resizeDrag) {
      return;
    }

    const handlePoint = this.getResizeHandlePoint(resizeDrag.baseElement, resizeDrag.handle);
    resizeDrag.current = point;
    resizeDrag.dragged =
      resizeDrag.dragged || distance(point, handlePoint) >= MIN_SELECTION_DRAG_DISTANCE;

    if (!resizeDrag.dragged) {
      return;
    }

    const preview = this.getResizedElement(resizeDrag, preserveAspectRatio);

    this.renderCurrent({
      hiddenElementIds: new Set([preview.id]),
      preview,
    });
  }

  private endResize(event: PointerEvent): void {
    const resizeDrag = this.resizeDrag;

    if (!resizeDrag) {
      return;
    }

    if (resizeDrag.dragged) {
      this.store.replaceElement(this.getResizedElement(resizeDrag, event.shiftKey));
    } else {
      this.renderSelection();
    }

    this.resizeDrag = undefined;
    this.pointerId = undefined;
    this.releasePointer(event.pointerId);
    this.updateResizeCursor(this.getWorldPoint(event));
  }

  private endArrowPointDrag(event: PointerEvent): void {
    const arrowPointDrag = this.arrowPointDrag;

    if (!arrowPointDrag) {
      return;
    }

    if (arrowPointDrag.dragged) {
      this.store.replaceElement(this.getDraggedArrowPointElement(arrowPointDrag));
    } else {
      this.renderSelection();
    }

    this.arrowPointDrag = undefined;
    this.pointerId = undefined;
    this.releasePointer(event.pointerId);
  }

  private endMove(event: PointerEvent): void {
    const moveDrag = this.moveDrag;

    if (!moveDrag) {
      return;
    }

    if (moveDrag.dragged) {
      this.store.replaceElements(this.getMovedElements(moveDrag));
    } else {
      this.renderSelection();
    }

    this.moveDrag = undefined;
    this.pointerId = undefined;
    this.releasePointer(event.pointerId);
  }

  private updateSelection(point: Point): void {
    if (!this.selectionDrag) {
      return;
    }

    this.selectionDrag.current = point;
    this.selectionDrag.dragged =
      this.selectionDrag.dragged ||
      Math.hypot(point.x - this.selectionDrag.origin.x, point.y - this.selectionDrag.origin.y) >=
        MIN_SELECTION_DRAG_DISTANCE;

    if (!this.selectionDrag.dragged) {
      return;
    }

    const selectionBox = this.getSelectionBox(this.selectionDrag);
    const selectedByArea = getElementsIntersectingRect(
      this.store.getSnapshot().elements,
      selectionBox,
    );
    const selectedIds = new Set(this.selectionDrag.additive ? [...this.selectionDrag.baseIds] : []);

    for (const element of selectedByArea) {
      selectedIds.add(element.id);
    }

    this.selectedElementIds = selectedIds;
    this.renderCurrent({
      selectionBox,
    });
  }

  private endSelection(event: PointerEvent): void {
    const selectionDrag = this.selectionDrag;

    if (!selectionDrag) {
      return;
    }

    if (!selectionDrag.dragged) {
      this.selectByClick(selectionDrag.origin, selectionDrag.additive);
    } else {
      this.renderSelection();
    }

    this.selectionDrag = undefined;
    this.pointerId = undefined;
    this.releasePointer(event.pointerId);
  }

  private selectByClick(point: Point, additive: boolean): void {
    const snapshot = this.store.getSnapshot();
    const hitElement = getElementAtPoint(snapshot.elements, point, 8 / snapshot.viewport.zoom);

    if (!hitElement) {
      if (!additive) {
        this.clearSelection();
      }
      return;
    }

    if (!additive) {
      this.selectedElementIds = new Set([hitElement.id]);
      this.renderSelection();
      return;
    }

    const selectedIds = new Set(this.selectedElementIds);

    if (selectedIds.has(hitElement.id)) {
      selectedIds.delete(hitElement.id);
    } else {
      selectedIds.add(hitElement.id);
    }

    this.selectedElementIds = selectedIds;
    this.renderSelection();
  }

  private getTextElementAtPoint(point: Point): TextElement | undefined {
    const snapshot = this.store.getSnapshot();
    const hitElement = getElementAtPoint(snapshot.elements, point, 8 / snapshot.viewport.zoom);

    return hitElement?.type === "text" ? hitElement : undefined;
  }

  private getElementScreenPoint(element: TextElement): Point {
    return worldToScreen({ x: element.x, y: element.y }, this.store.getSnapshot().viewport);
  }

  private commitTextElementEdit(originalElement: TextElement, text: string): void {
    if (text.trim().length === 0) {
      this.store.removeElements(new Set([originalElement.id]));
      this.selectedElementIds = new Set<string>();
      this.finishTextElementEdit(originalElement.id);
      return;
    }

    const currentElement = this.store
      .getSnapshot()
      .elements.find((element) => element.id === originalElement.id);

    if (currentElement?.type !== "text") {
      this.finishTextElementEdit(originalElement.id);
      return;
    }

    const width = currentElement.width;
    const height = this.measureTextHeight(text, width, currentElement.fontSize);

    if (currentElement.text === text && Math.abs(currentElement.height - height) < 0.5) {
      this.finishTextElementEdit(originalElement.id);
      return;
    }

    const updatedElement = {
      ...updateTextElementText(currentElement, text),
      width,
      height,
    };
    this.store.replaceElement(updatedElement);
    this.selectedElementIds = new Set([updatedElement.id]);
    this.finishTextElementEdit(updatedElement.id);
  }

  private measureTextWidth(text: string, fontSize: number): number {
    const context = this.canvas.getContext("2d");

    return context
      ? measureTextElementWidth(context, text, fontSize)
      : getTextElementWidth(text, fontSize);
  }

  private measureTextHeight(text: string, width: number, fontSize: number): number {
    const context = this.canvas.getContext("2d");

    return context
      ? measureTextElementHeight(context, text, width, fontSize)
      : getTextElementHeight(text, fontSize, width, this.measureTextContent);
  }

  private measureTextContent = (text: string, fontSize: number): number => {
    const context = this.canvas.getContext("2d");

    if (!context) {
      return Math.max(0, getTextElementWidth(text, fontSize) - 6);
    }

    context.save();
    context.font = getCanvasTextFont(fontSize);
    const width = context.measureText(text).width;
    context.restore();

    return width;
  };

  private finishTextElementEdit(elementId: string): void {
    if (this.editingTextElementId !== elementId) {
      return;
    }

    this.editingTextElementId = undefined;
    this.renderSelection();
  }

  private clearSelection(): void {
    if (this.selectedElementIds.size === 0) {
      return;
    }

    this.selectedElementIds = new Set<string>();
    this.canvas.style.cursor = "";
    this.renderSelection();
  }

  private renderSelection(): void {
    this.renderCurrent();
    this.onSelectionChange();
  }

  private renderCurrent(options: CanvasRenderOptions = {}): void {
    this.renderPreview({
      ...options,
      hiddenElementIds: this.getHiddenElementIds(options.hiddenElementIds),
      selectedElementIds: this.selectedElementIds,
    });
  }

  private getHiddenElementIds(hiddenElementIds: Set<string> | undefined): Set<string> | undefined {
    if (!this.editingTextElementId) {
      return hiddenElementIds;
    }

    return new Set([...(hiddenElementIds ?? []), this.editingTextElementId]);
  }

  private getSelectionBox(selectionDrag: SelectionDrag): Rect {
    return normalizeRect({
      x: selectionDrag.origin.x,
      y: selectionDrag.origin.y,
      width: selectionDrag.current.x - selectionDrag.origin.x,
      height: selectionDrag.current.y - selectionDrag.origin.y,
    });
  }

  private getMovedElements(moveDrag: MoveDrag): DrawingElement[] {
    return moveDrag.baseElements.map((element) =>
      translateElement(element, {
        x: moveDrag.current.x - moveDrag.origin.x,
        y: moveDrag.current.y - moveDrag.origin.y,
      }),
    );
  }

  private getDraggedArrowPointElement(arrowPointDrag: ArrowPointDrag): ArrowElement {
    return updateArrowPoint(
      arrowPointDrag.baseElement,
      arrowPointDrag.pointIndex,
      arrowPointDrag.current,
    );
  }

  private getResizedElement(
    resizeDrag: ResizeDrag,
    preserveAspectRatio: boolean,
  ): ShapeElement | TextElement {
    return resizeElement(resizeDrag.baseElement, resizeDrag.handle, resizeDrag.current, {
      preserveAspectRatio,
      measureText: this.measureTextContent,
    });
  }

  private getResizeHandlePoint(element: ShapeElement | TextElement, handle: ResizeHandle): Point {
    return getResizeHandlePoints(getElementBounds(element))[handle];
  }

  private updateResizeCursor(point: Point): void {
    const [element] = this.getSelectedElements();

    if (this.selectedElementIds.size !== 1 || !element || !isResizableElement(element)) {
      this.canvas.style.cursor = "";
      return;
    }

    const zoom = this.store.getSnapshot().viewport.zoom;
    const handle = getResizeHandleAtPoint(getElementBounds(element), point, 10 / zoom);

    if (handle) {
      this.setResizeCursor(handle);
    } else {
      this.canvas.style.cursor = "";
    }
  }

  private setResizeCursor(handle: ResizeHandle): void {
    if (handle === "n" || handle === "s") {
      this.canvas.style.cursor = "ns-resize";
      return;
    }

    if (handle === "e" || handle === "w") {
      this.canvas.style.cursor = "ew-resize";
      return;
    }

    this.canvas.style.cursor = handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize";
  }

  private getSelectedElements(): DrawingElement[] {
    const selectedIds = this.selectedElementIds;

    return this.store.getSnapshot().elements.filter((element) => selectedIds.has(element.id));
  }

  private getPasteTarget(): Point {
    if (this.lastCursorWorldPoint) {
      return this.lastCursorWorldPoint;
    }

    const rect = this.canvas.getBoundingClientRect();

    return screenToWorld(
      {
        x: rect.width / 2,
        y: rect.height / 2,
      },
      this.store.getSnapshot().viewport,
    );
  }

  private applyCurrentStyle<T extends DrawingElement>(element: T): T {
    const borderRadius =
      element.type === "rectangle" || element.type === "diamond"
        ? this.currentStyle.borderRadius
        : DEFAULT_STYLE.borderRadius;

    return {
      ...element,
      style: {
        ...element.style,
        ...this.currentStyle,
        borderRadius,
      },
    };
  }

  private isDrawableDraft(draft: DrawingElement): boolean {
    if (draft.type === "brush") {
      return draft.points.length > 1;
    }

    if (draft.type === "arrow") {
      return this.isDrawableArrowPoints(draft.points);
    }

    if (draft.type === "text") {
      return draft.text.trim().length > 0;
    }

    return Math.abs(draft.width) >= MIN_SHAPE_SIZE && Math.abs(draft.height) >= MIN_SHAPE_SIZE;
  }

  private zoomAtCanvasCenter(factor: number): void {
    const viewport = this.store.getSnapshot().viewport;

    this.updateViewportZoomAt(this.getCanvasCenterPoint(), viewport.zoom * factor);
  }

  private updateViewportZoomAt(screenPoint: Point, nextZoom: number): void {
    const nextViewport = zoomViewportAtScreenPoint(
      this.store.getSnapshot().viewport,
      screenPoint,
      nextZoom,
    );

    this.lastCursorWorldPoint = screenToWorld(screenPoint, nextViewport);
    this.updateViewportIfChanged(nextViewport);
  }

  private updateViewportIfChanged(nextViewport: Viewport): void {
    const currentViewport = this.store.getSnapshot().viewport;

    if (
      currentViewport.x === nextViewport.x &&
      currentViewport.y === nextViewport.y &&
      currentViewport.zoom === nextViewport.zoom
    ) {
      return;
    }

    this.store.updateViewport(nextViewport);
  }

  private panByWheelDelta(delta: Point): void {
    const viewport = this.store.getSnapshot().viewport;

    this.updateViewportIfChanged({
      ...viewport,
      x: viewport.x - delta.x,
      y: viewport.y - delta.y,
    });
  }

  private getNormalizedWheelDelta(event: WheelEvent): Point {
    const delta = {
      x: event.deltaX,
      y: event.deltaY,
    };

    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      return {
        x: delta.x * 16,
        y: delta.y * 16,
      };
    }

    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      return {
        x: delta.x * this.canvas.clientWidth,
        y: delta.y * this.canvas.clientHeight,
      };
    }

    return delta;
  }

  private getCenterPoint(firstPoint: Point, secondPoint: Point): Point {
    return {
      x: (firstPoint.x + secondPoint.x) / 2,
      y: (firstPoint.y + secondPoint.y) / 2,
    };
  }

  private getCanvasCenterPoint(): Point {
    const rect = this.canvas.getBoundingClientRect();

    return {
      x: rect.width / 2,
      y: rect.height / 2,
    };
  }

  private cancelActivePointerInteraction(): void {
    const wasPanning = this.isPanning;

    this.draft = undefined;
    this.selectionDrag = undefined;
    this.moveDrag = undefined;
    this.resizeDrag = undefined;
    this.arrowPointDrag = undefined;
    this.cancelArrowDraft();
    this.isPanning = false;
    this.panStart = undefined;
    this.panViewportStart = undefined;
    this.pointerId = undefined;

    if (wasPanning) {
      this.togglePanning(false);
    }

    this.renderSelection();
  }

  private startPan(event: PointerEvent): void {
    event.preventDefault();
    this.canvas.style.cursor = "";
    const viewport = this.store.getSnapshot().viewport;
    this.isPanning = true;
    this.panStart = this.getScreenPoint(event);
    this.panViewportStart = { x: viewport.x, y: viewport.y };
    this.togglePanning(true);
  }

  private updatePan(event: PointerEvent): void {
    if (!this.panStart || !this.panViewportStart) {
      return;
    }

    const point = this.getScreenPoint(event);
    const deltaX = point.x - this.panStart.x;
    const deltaY = point.y - this.panStart.y;
    const snapshot = this.store.getSnapshot();

    this.store.updateViewport({
      ...snapshot.viewport,
      x: this.panViewportStart.x + deltaX,
      y: this.panViewportStart.y + deltaY,
    });
  }

  private endPan(event: PointerEvent): void {
    this.isPanning = false;
    this.panStart = undefined;
    this.panViewportStart = undefined;
    this.pointerId = undefined;
    this.togglePanning(false);
    this.releasePointer(event.pointerId);
  }

  private getWorldPoint(event: MouseEvent | PointerEvent): Point {
    const worldPoint = screenToWorld(this.getScreenPoint(event), this.store.getSnapshot().viewport);
    this.lastCursorWorldPoint = worldPoint;

    return worldPoint;
  }

  private getScreenPoint(event: MouseEvent | PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  private releasePointer(pointerId: number): void {
    if (this.canvas.hasPointerCapture(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }
  }
}
