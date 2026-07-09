import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_STYLE,
  IndexedDbSceneRepository,
  SceneStore,
  type LayerOrderCommand,
  type SaveState,
  type Tool,
} from "@/entities/scene";

import { TOOLS } from "../config/editorConfig";
import { CanvasRenderer, type CanvasRenderOptions } from "../lib/CanvasRenderer";
import { EditorController } from "./EditorController";

const TEXT_EDITOR_VERTICAL_OFFSET = 2;
const DEFAULT_STROKE_COLOR = DEFAULT_STYLE.stroke;
const DEFAULT_FILL_COLOR = DEFAULT_STYLE.fill;
const DEFAULT_LINE_WIDTH = DEFAULT_STYLE.lineWidth;

type TextEditorOptions = {
  initialText?: string;
  fontSize?: number;
  textColor?: string;
  onCommit: (text: string) => void;
  onCancel?: () => void;
};

const isTextInputTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;

  return element?.tagName === "TEXTAREA" || element?.tagName === "INPUT";
};

export function useEditorRuntime() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textEditorRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<EditorController | null>(null);
  const storeRef = useRef<SceneStore | null>(null);

  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isPanning, setIsPanning] = useState(false);
  const [strokeColor, setStrokeColorState] = useState(DEFAULT_STROKE_COLOR);
  const [fillColor, setFillColorState] = useState(DEFAULT_FILL_COLOR);
  const [lineWidth, setLineWidthState] = useState(DEFAULT_LINE_WIDTH);
  const [hasSelection, setHasSelection] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textEditor = textEditorRef.current;

    if (!canvas || !textEditor) {
      return undefined;
    }

    const repository = new IndexedDbSceneRepository();
    const store = new SceneStore(repository);
    const renderer = new CanvasRenderer(canvas);
    let latestScene = store.getSnapshot();
    let latestRenderOptions: CanvasRenderOptions = {};
    let closeOpenTextEditor: (() => void) | undefined;

    const renderWithPreview = (options: CanvasRenderOptions = {}): void => {
      latestRenderOptions = options;
      renderer.render(latestScene, options);
    };

    const updateSelectionState = (): void => {
      setHasSelection(controller.getSelectedElementIds().size > 0);
    };

    const openTextEditor = (
      screenPoint: { x: number; y: number },
      options: TextEditorOptions,
    ): void => {
      closeOpenTextEditor?.();

      const viewportZoom = latestScene.viewport.zoom;
      const baseFontSize = options.fontSize ?? 24;
      const editorFontSize = Math.max(14, baseFontSize * viewportZoom);
      let isOpen = true;
      let shouldCommit = true;

      const resizeEditor = (): void => {
        const lines = textEditor.value.split("\n");
        const longestLineLength = Math.max(1, ...lines.map((line) => line.length));
        const width = Math.min(
          Math.max(longestLineLength * editorFontSize * 0.62 + 14, 120 * viewportZoom),
          460,
        );
        const height = Math.max(lines.length * editorFontSize * 1.3 + 6, 32 * viewportZoom);

        textEditor.style.width = `${width}px`;
        textEditor.style.height = `${height}px`;
      };

      const close = (): void => {
        if (!isOpen) {
          return;
        }

        isOpen = false;
        textEditor.removeAttribute("data-open");
        textEditor.removeEventListener("input", resizeEditor);
        textEditor.onblur = null;
        textEditor.onkeydown = null;
        closeOpenTextEditor = undefined;

        if (shouldCommit) {
          options.onCommit(textEditor.value);
        } else {
          options.onCancel?.();
        }
      };

      const cancel = (): void => {
        shouldCommit = false;
        close();
      };

      closeOpenTextEditor = close;
      textEditor.value = options.initialText ?? "";
      textEditor.dataset.open = "true";
      textEditor.style.left = `${screenPoint.x}px`;
      textEditor.style.top = `${screenPoint.y - TEXT_EDITOR_VERTICAL_OFFSET}px`;
      textEditor.style.color = options.textColor ?? "var(--text)";
      textEditor.style.fontSize = `${editorFontSize}px`;
      textEditor.addEventListener("input", resizeEditor);
      textEditor.onblur = close;
      textEditor.onkeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
          return;
        }

        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          close();
        }
      };
      resizeEditor();
      window.setTimeout(() => {
        if (isOpen) {
          textEditor.focus();
          textEditor.setSelectionRange(textEditor.value.length, textEditor.value.length);
        }
      }, 0);
    };

    const controller = new EditorController(
      canvas,
      store,
      renderWithPreview,
      (nextIsPanning) => {
        canvas.dataset.panning = String(nextIsPanning);
        setIsPanning(nextIsPanning);
      },
      openTextEditor,
      updateSelectionState,
      setActiveTool,
    );

    controllerRef.current = controller;
    storeRef.current = store;
    setActiveTool(controller.getTool());
    updateSelectionState();

    const resizeObserver = new ResizeObserver(() => {
      renderer.resize();
      renderer.render(latestScene, latestRenderOptions);
    });

    resizeObserver.observe(canvas);
    renderer.resize();

    const unsubscribeScene = store.subscribe((scene) => {
      latestScene = scene;
      setZoom(scene.viewport.zoom);
      renderer.render(scene, latestRenderOptions);
      controller.refreshSelection();
    });

    const unsubscribeSaveState = store.subscribeSaveState(setSaveState);

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isTextInputTarget(event.target)) {
        return;
      }

      const currentController = controllerRef.current;
      const currentStore = storeRef.current;

      if (!currentController || !currentStore) {
        return;
      }

      const isModifierShortcut = event.ctrlKey || event.metaKey;
      const isZKey = event.key.toLowerCase() === "z" || event.code === "KeyZ";
      const isAKey = event.key.toLowerCase() === "a" || event.code === "KeyA";
      const isCKey = event.key.toLowerCase() === "c" || event.code === "KeyC";
      const isVKey = event.key.toLowerCase() === "v" || event.code === "KeyV";
      const isZoomInKey =
        event.key === "+" ||
        event.key === "=" ||
        event.code === "Equal" ||
        event.code === "NumpadAdd";
      const isZoomOutKey =
        event.key === "-" ||
        event.key === "_" ||
        event.code === "Minus" ||
        event.code === "NumpadSubtract";
      const isResetZoomKey =
        event.key === "0" || event.code === "Digit0" || event.code === "Numpad0";

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        currentController.deleteSelection();
        return;
      }

      if (isModifierShortcut && isZKey) {
        event.preventDefault();

        if (event.shiftKey) {
          currentStore.redo();
        } else {
          currentStore.undo();
        }

        currentController.refreshSelection();
        return;
      }

      if (isModifierShortcut && isAKey) {
        event.preventDefault();
        currentController.selectAll();
        return;
      }

      if (isModifierShortcut && isCKey) {
        event.preventDefault();
        currentController.copySelection();
        return;
      }

      if (isModifierShortcut && isVKey) {
        event.preventDefault();
        currentController.pasteSelection();
        return;
      }

      if (isModifierShortcut && isZoomInKey) {
        event.preventDefault();
        currentController.zoomIn();
        return;
      }

      if (isModifierShortcut && isZoomOutKey) {
        event.preventDefault();
        currentController.zoomOut();
        return;
      }

      if (isModifierShortcut && isResetZoomKey) {
        event.preventDefault();
        currentController.resetZoom();
        return;
      }

      if (isModifierShortcut) {
        return;
      }

      const nextTool = TOOLS.find(
        (candidate) =>
          candidate.shortcut.toLowerCase() === event.key.toLowerCase() ||
          candidate.numericShortcut === event.key,
      );

      if (!nextTool) {
        return;
      }

      currentController.setTool(nextTool.id);
    };

    window.addEventListener("keydown", handleKeyDown);
    void store.hydrate();

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unsubscribeScene();
      unsubscribeSaveState();
      resizeObserver.disconnect();
      closeOpenTextEditor?.();
      controller.destroy();
      controllerRef.current = null;
      storeRef.current = null;
      setIsPanning(false);
      setHasSelection(false);
      setZoom(1);
    };
  }, []);

  const setTool = useCallback((tool: Tool): void => {
    controllerRef.current?.setTool(tool);
  }, []);

  const setStrokeColor = useCallback((color: string): void => {
    setStrokeColorState(color);
    controllerRef.current?.setStyle({ stroke: color });
  }, []);

  const setFillColor = useCallback((color: string): void => {
    setFillColorState(color);
    controllerRef.current?.setStyle({ fill: color });
  }, []);

  const setLineWidth = useCallback((nextLineWidth: number): void => {
    setLineWidthState(nextLineWidth);
    controllerRef.current?.setStyle({ lineWidth: nextLineWidth });
  }, []);

  const clearScene = useCallback((): void => {
    storeRef.current?.clear();
    controllerRef.current?.refreshSelection();
  }, []);

  const exportPng = useCallback((): void => {
    controllerRef.current?.exportPng();
  }, []);

  const zoomIn = useCallback((): void => {
    controllerRef.current?.zoomIn();
  }, []);

  const zoomOut = useCallback((): void => {
    controllerRef.current?.zoomOut();
  }, []);

  const resetZoom = useCallback((): void => {
    controllerRef.current?.resetZoom();
  }, []);

  const updateSelectionLayer = useCallback((command: LayerOrderCommand): void => {
    controllerRef.current?.updateSelectionLayer(command);
  }, []);

  return {
    activeTool,
    canvasRef,
    clearScene,
    exportPng,
    fillColor,
    hasSelection,
    isPanning,
    lineWidth,
    saveState,
    setFillColor,
    setLineWidth,
    setStrokeColor,
    setTool,
    strokeColor,
    textEditorRef,
    updateSelectionLayer,
    zoom,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}
