import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_TEXT_ALIGN,
  DEFAULT_STYLE,
  IndexedDbSceneRepository,
  SceneStore,
  getTextElementWidth,
  type SaveState,
  type BorderRadius,
  type TextAlign,
  type Tool,
} from "@/entities/scene";

import { CanvasRenderer, type CanvasRenderOptions } from "../lib/CanvasRenderer";
import { getInlineTextEditorMetrics } from "../lib/textEditorMetrics";
import { measureTextElementHeight, measureTextElementWidth } from "../lib/textMeasurement";
import { EditorController } from "./EditorController";
import { getEditorShortcut } from "./editorShortcuts";
import type { ObjectSettingsSnapshot } from "./objectSettings";
import { EditorRuntimeContext, type EditorRuntime } from "./useEditorRuntime";

const DEFAULT_STROKE_COLOR = DEFAULT_STYLE.stroke;
const DEFAULT_BORDER_RADIUS = DEFAULT_STYLE.borderRadius;
const DEFAULT_FILL_COLOR = DEFAULT_STYLE.fill;
const DEFAULT_LINE_WIDTH = DEFAULT_STYLE.lineWidth;
const DEFAULT_OPACITY = DEFAULT_STYLE.opacity;

type EditorRuntimeProviderProps = {
  children: ReactNode;
};

type TextEditorOptions = {
  initialText?: string;
  fontSize?: number;
  width?: number;
  textColor?: string;
  textAlign?: TextAlign;
  onCommit: (text: string) => void;
  onCancel?: () => void;
};

const initialMixedObjectSettings: ObjectSettingsSnapshot["mixed"] = {
  borderRadius: false,
  fill: false,
  lineWidth: false,
  opacity: false,
  stroke: false,
  textAlign: false,
};

const isTextInputTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;

  return element?.tagName === "TEXTAREA" || element?.tagName === "INPUT";
};

export function EditorRuntimeProvider({ children }: EditorRuntimeProviderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textEditorRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<EditorController | null>(null);
  const storeRef = useRef<SceneStore | null>(null);

  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isPanning, setIsPanning] = useState(false);
  const [strokeColor, setStrokeColorState] = useState(DEFAULT_STROKE_COLOR);
  const [borderRadius, setBorderRadiusState] = useState<BorderRadius>(DEFAULT_BORDER_RADIUS);
  const [fillColor, setFillColorState] = useState(DEFAULT_FILL_COLOR);
  const [lineWidth, setLineWidthState] = useState(DEFAULT_LINE_WIDTH);
  const [opacity, setOpacityState] = useState(DEFAULT_OPACITY);
  const [textAlign, setTextAlignState] = useState<TextAlign>(DEFAULT_TEXT_ALIGN);
  const [hasSelection, setHasSelection] = useState(false);
  const [hasBorderRadiusSelection, setHasBorderRadiusSelection] = useState(false);
  const [hasTextSelection, setHasTextSelection] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  const [mixedObjectSettings, setMixedObjectSettings] = useState(initialMixedObjectSettings);
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
    let controller: EditorController | undefined;
    let disposed = false;

    const renderWithPreview = (options: CanvasRenderOptions = {}): void => {
      latestRenderOptions = options;
      renderer.render(latestScene, options);
    };

    const updateObjectSettingsState = (): void => {
      if (!controller) {
        return;
      }

      const settings = controller.getObjectSettings();

      setHasSelection(settings.hasSelection);
      setHasBorderRadiusSelection(settings.hasBorderRadiusSelection);
      setHasTextSelection(settings.hasTextSelection);
      setSelectionCount(settings.selectionCount);
      setStrokeColorState(settings.style.stroke);
      setBorderRadiusState(settings.style.borderRadius);
      setFillColorState(settings.style.fill);
      setLineWidthState(settings.style.lineWidth);
      setOpacityState(settings.style.opacity);
      setTextAlignState(settings.textAlign);
      setMixedObjectSettings(settings.mixed);
    };

    const openTextEditor = (
      screenPoint: { x: number; y: number },
      options: TextEditorOptions,
    ): void => {
      closeOpenTextEditor?.();

      const viewportZoom = latestScene.viewport.zoom;
      const baseFontSize = options.fontSize ?? 24;
      const shouldWrap = typeof options.width === "number" && options.width > 0;
      let isOpen = true;
      let shouldCommit = true;

      const measureTextWidth = (text: string, fontSize: number): number => {
        const context = canvas.getContext("2d");

        return context
          ? measureTextElementWidth(context, text, fontSize)
          : getTextElementWidth(text, fontSize);
      };

      const resizeEditor = (): void => {
        const context = canvas.getContext("2d");
        const metrics = getInlineTextEditorMetrics({
          text: textEditor.value,
          fontSize: baseFontSize,
          width: options.width,
          viewportZoom,
          measureTextWidth,
          measureTextHeight: context
            ? (text, fontSize, width) => measureTextElementHeight(context, text, width, fontSize)
            : undefined,
        });

        textEditor.style.width = `${metrics.width}px`;
        textEditor.style.height = `${metrics.height}px`;
        textEditor.style.fontSize = `${metrics.fontSize}px`;
        textEditor.style.transform = `scale(${metrics.scale})`;
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
      textEditor.style.top = `${screenPoint.y}px`;
      textEditor.style.color = options.textColor ?? "var(--text)";
      textEditor.style.textAlign = options.textAlign ?? DEFAULT_TEXT_ALIGN;
      textEditor.style.whiteSpace = shouldWrap ? "pre-wrap" : "pre";
      textEditor.style.overflowWrap = shouldWrap ? "anywhere" : "normal";
      textEditor.wrap = shouldWrap ? "soft" : "off";
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

    const resizeObserver = new ResizeObserver(() => {
      renderer.resize();
      renderer.render(latestScene, latestRenderOptions);
    });

    resizeObserver.observe(canvas);
    renderer.resize();

    const unsubscribeScene = store.subscribe((scene) => {
      latestScene = scene;
      setZoom(scene.viewport.zoom);

      if (controller) {
        controller.refreshSelection(scene);
      } else {
        renderer.render(scene, latestRenderOptions);
      }
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

      const shortcut = getEditorShortcut(event);

      if (!shortcut) {
        return;
      }

      event.preventDefault();

      switch (shortcut.type) {
        case "copy-selection":
          currentController.copySelection();
          return;
        case "delete-selection":
          currentController.deleteSelection();
          return;
        case "paste-selection":
          currentController.pasteSelection();
          return;
        case "redo":
          currentStore.redo();
          return;
        case "reset-zoom":
          currentController.resetZoom();
          return;
        case "select-all":
          currentController.selectAll();
          return;
        case "set-tool":
          currentController.setTool(shortcut.tool);
          return;
        case "undo":
          currentStore.undo();
          return;
        case "zoom-in":
          currentController.zoomIn();
          return;
        case "zoom-out":
          currentController.zoomOut();
      }
    };

    const initialize = async (): Promise<void> => {
      await store.hydrate();

      if (disposed) {
        return;
      }

      controller = new EditorController(
        canvas,
        store,
        renderWithPreview,
        (nextIsPanning) => {
          canvas.dataset.panning = String(nextIsPanning);
          setIsPanning(nextIsPanning);
        },
        openTextEditor,
        updateObjectSettingsState,
        setActiveTool,
      );

      controllerRef.current = controller;
      storeRef.current = store;
      setActiveTool(controller.getTool());
      updateObjectSettingsState();
      window.addEventListener("keydown", handleKeyDown);
    };

    void initialize();

    return () => {
      disposed = true;
      window.removeEventListener("keydown", handleKeyDown);
      unsubscribeScene();
      unsubscribeSaveState();
      resizeObserver.disconnect();
      closeOpenTextEditor?.();
      controller?.destroy();
      controllerRef.current = null;
      storeRef.current = null;
      setIsPanning(false);
      setHasSelection(false);
      setHasBorderRadiusSelection(false);
      setHasTextSelection(false);
      setSelectionCount(0);
      setMixedObjectSettings(initialMixedObjectSettings);
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

  const setBorderRadius = useCallback((nextBorderRadius: BorderRadius): void => {
    setBorderRadiusState(nextBorderRadius);
    controllerRef.current?.setBorderRadius(nextBorderRadius);
  }, []);

  const setFillColor = useCallback((color: string): void => {
    setFillColorState(color);
    controllerRef.current?.setStyle({ fill: color });
  }, []);

  const setLineWidth = useCallback((nextLineWidth: number): void => {
    setLineWidthState(nextLineWidth);
    controllerRef.current?.setStyle({ lineWidth: nextLineWidth });
  }, []);

  const setOpacity = useCallback((nextOpacity: number): void => {
    const opacityValue = Math.min(Math.max(nextOpacity, 0), 1);

    setOpacityState(opacityValue);
    controllerRef.current?.setStyle({ opacity: opacityValue });
  }, []);

  const setTextAlign = useCallback((nextTextAlign: TextAlign): void => {
    setTextAlignState(nextTextAlign);
    controllerRef.current?.setTextAlign(nextTextAlign);
  }, []);

  const clearScene = useCallback((): void => {
    storeRef.current?.clear();
  }, []);

  const exportPng = useCallback((): void => {
    controllerRef.current?.exportPng();
  }, []);

  const copySelection = useCallback((): void => {
    controllerRef.current?.copySelection();
  }, []);

  const deleteSelection = useCallback((): void => {
    controllerRef.current?.deleteSelection();
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

  const updateSelectionLayer = useCallback<EditorRuntime["updateSelectionLayer"]>((command) => {
    controllerRef.current?.updateSelectionLayer(command);
  }, []);

  const runtime = useMemo<EditorRuntime>(
    () => ({
      activeTool,
      borderRadius,
      canvasRef,
      clearScene,
      copySelection,
      deleteSelection,
      exportPng,
      fillColor,
      hasBorderRadiusSelection,
      hasSelection,
      hasTextSelection,
      isPanning,
      lineWidth,
      mixedObjectSettings,
      opacity,
      saveState,
      setFillColor,
      setBorderRadius,
      setLineWidth,
      setOpacity,
      setStrokeColor,
      setTextAlign,
      setTool,
      selectionCount,
      strokeColor,
      textAlign,
      textEditorRef,
      updateSelectionLayer,
      zoom,
      zoomIn,
      zoomOut,
      resetZoom,
    }),
    [
      activeTool,
      borderRadius,
      clearScene,
      copySelection,
      deleteSelection,
      exportPng,
      fillColor,
      hasBorderRadiusSelection,
      hasSelection,
      hasTextSelection,
      isPanning,
      lineWidth,
      mixedObjectSettings,
      opacity,
      resetZoom,
      saveState,
      selectionCount,
      setFillColor,
      setBorderRadius,
      setLineWidth,
      setOpacity,
      setStrokeColor,
      setTextAlign,
      setTool,
      strokeColor,
      textAlign,
      updateSelectionLayer,
      zoom,
      zoomIn,
      zoomOut,
    ],
  );

  return <EditorRuntimeContext.Provider value={runtime}>{children}</EditorRuntimeContext.Provider>;
}
