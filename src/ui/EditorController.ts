import {
  DEFAULT_STYLE,
  createArrowElement,
  createBrushElement,
  createShapeElement,
  createTextElement,
  updateTextElementText,
  type ArrowElement,
  type BrushElement,
  type DrawingElement,
  type ElementStyle,
  type Point,
  type ShapeElement,
  type TextElement,
  type Tool,
} from "../domain/elements";
import {
  constrainToSquareDelta,
  normalizeRect,
  screenToWorld,
  shouldAppendPoint,
  worldToScreen,
  type Rect,
} from "../domain/geometry";
import {
  cloneElementsAt,
  getElementAtPoint,
  getElementsIntersectingRect,
  translateElement,
} from "../domain/selection";
import type { SceneStore } from "../application/SceneStore";
import type { LayerOrderCommand } from "../application/SceneStore";
import type { CanvasRenderOptions } from "./CanvasRenderer";

type RenderPreview = (options?: CanvasRenderOptions) => void;
type TogglePanning = (isPanning: boolean) => void;
type SelectionChangeListener = () => void;
type TextEditorOptions = {
  initialText?: string;
  fontSize?: number;
  textColor?: string;
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

const MIN_SHAPE_SIZE = 6;
const MIN_SELECTION_DRAG_DISTANCE = 4;
const MIDDLE_MOUSE_BUTTON = 1;
const PRIMARY_MOUSE_BUTTON = 0;

export class EditorController {
  private activeTool: Tool = "select";
  private currentStyle: Partial<ElementStyle> = {
    stroke: DEFAULT_STYLE.stroke,
    fill: DEFAULT_STYLE.fill,
  };
  private draft: DrawingElement | undefined;
  private isPanning = false;
  private selectionDrag: SelectionDrag | undefined;
  private moveDrag: MoveDrag | undefined;
  private selectedElementIds = new Set<string>();
  private editingTextElementId: string | undefined;
  private clipboard: DrawingElement[] = [];
  private lastCursorWorldPoint: Point | undefined;
  private panStart: Point | undefined;
  private panViewportStart: Point | undefined;
  private pointerId: number | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly store: SceneStore,
    private readonly renderPreview: RenderPreview,
    private readonly togglePanning: TogglePanning,
    private readonly openTextEditor: (screenPoint: Point, options: TextEditorOptions) => void,
    private readonly onSelectionChange: SelectionChangeListener = () => {},
  ) {
    this.bind();
    this.canvas.dataset.tool = this.activeTool;
  }

  setTool(tool: Tool): void {
    this.activeTool = tool;
    this.canvas.dataset.tool = tool;
    this.renderSelection();
  }

  getTool(): Tool {
    return this.activeTool;
  }

  setStyle(stylePatch: Partial<ElementStyle>): void {
    this.currentStyle = {
      ...this.currentStyle,
      ...stylePatch,
    };
    this.store.updateElementsStyle(this.selectedElementIds, stylePatch);
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

  deleteSelection(): boolean {
    if (this.selectedElementIds.size === 0) {
      return false;
    }

    this.store.removeElements(new Set(this.selectedElementIds));
    this.selectedElementIds = new Set<string>();
    this.renderSelection();

    return true;
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

  refreshSelection(): void {
    const existingElementIds = new Set(
      this.store.getSnapshot().elements.map((element) => element.id),
    );
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

  private bind(): void {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerUp);
    this.canvas.addEventListener("dblclick", this.handleDoubleClick);
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);

    if (event.button === MIDDLE_MOUSE_BUTTON) {
      this.startPan(event);
      return;
    }

    if (event.button !== PRIMARY_MOUSE_BUTTON) {
      return;
    }

    const screenPoint = this.getScreenPoint(event);
    const worldPoint = this.getWorldPoint(event);

    if (this.activeTool === "text") {
      this.openTextEditor(screenPoint, {
        onCommit: (text) => {
          const trimmedText = text.trim();

          if (trimmedText.length > 0) {
            const element = this.applyCurrentStyle(createTextElement(worldPoint, trimmedText));
            this.store.addElement(element);
            this.selectedElementIds = new Set([element.id]);
            this.renderSelection();
          }
        },
      });
      return;
    }

    if (this.activeTool === "select") {
      this.startSelectInteraction(event, worldPoint);
      return;
    }

    this.clearSelection();
    this.draft = this.createDraft(worldPoint);
    this.renderCurrent({ preview: this.draft });
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const worldPoint = this.getWorldPoint(event);

    if (this.pointerId !== event.pointerId) {
      return;
    }

    if (this.isPanning) {
      this.updatePan(event);
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

    this.draft = this.updateDraft(this.draft, worldPoint);
    this.renderCurrent({ preview: this.draft });
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) {
      return;
    }

    if (this.isPanning) {
      this.endPan(event);
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

    if (this.draft && this.isDrawableDraft(this.draft)) {
      this.store.addElement(this.draft);
    }

    this.draft = undefined;
    this.pointerId = undefined;
    this.releasePointer(event.pointerId);
    this.renderSelection();
  };

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
    this.pointerId = undefined;
    this.selectedElementIds = new Set([textElement.id]);
    this.renderSelection();

    this.openTextEditor(this.getElementScreenPoint(textElement), {
      initialText: textElement.text,
      fontSize: textElement.fontSize,
      textColor: textElement.style.stroke,
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

    if (tool === "arrow") {
      return this.applyCurrentStyle(createArrowElement(point, point));
    }

    if (tool === "square" || tool === "diamond" || tool === "circle") {
      return this.applyCurrentStyle(createShapeElement(tool, point, point));
    }

    throw new Error("Only drawing tools create drafts.");
  }

  private updateDraft(draft: DrawingElement, point: Point): DrawingElement {
    if (draft.type === "brush") {
      return this.updateBrush(draft, point);
    }

    if (draft.type === "arrow") {
      return {
        ...draft,
        end: point,
        updatedAt: Date.now(),
      } satisfies ArrowElement;
    }

    if (draft.type === "square" || draft.type === "diamond" || draft.type === "circle") {
      const width = point.x - draft.x;
      const height = point.y - draft.y;
      const shouldConstrain = draft.type === "square" || draft.type === "circle";
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

  private startSelectInteraction(event: PointerEvent, point: Point): void {
    if (!event.shiftKey && this.startMoveIfPossible(point)) {
      return;
    }

    this.startSelection(event, point);
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
    const trimmedText = text.trim();

    if (trimmedText.length === 0) {
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

    if (currentElement.text === trimmedText) {
      this.finishTextElementEdit(originalElement.id);
      return;
    }

    const updatedElement = updateTextElementText(currentElement, trimmedText);
    this.store.replaceElement(updatedElement);
    this.selectedElementIds = new Set([updatedElement.id]);
    this.finishTextElementEdit(updatedElement.id);
  }

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
    return {
      ...element,
      style: {
        ...element.style,
        ...this.currentStyle,
      },
    };
  }

  private isDrawableDraft(draft: DrawingElement): boolean {
    if (draft.type === "brush") {
      return draft.points.length > 1;
    }

    if (draft.type === "arrow") {
      return Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y) >= MIN_SHAPE_SIZE;
    }

    if (draft.type === "text") {
      return draft.text.trim().length > 0;
    }

    return Math.abs(draft.width) >= MIN_SHAPE_SIZE && Math.abs(draft.height) >= MIN_SHAPE_SIZE;
  }

  private startPan(event: PointerEvent): void {
    event.preventDefault();
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
