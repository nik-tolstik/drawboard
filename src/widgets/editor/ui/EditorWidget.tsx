import type { SaveState, Tool } from "@/entities/scene";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Separator } from "@/shared/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";

import { TOOLS, getToolTitle, isObjectTool } from "../config/editorConfig";
import { useEditorRuntime } from "../model/useEditorRuntime";
import { EditorIcon } from "./EditorIcon";
import { ObjectSettingsPanel } from "./ObjectSettingsPanel";

const saveStateLabels: Record<SaveState, string> = {
  idle: "Ready",
  loading: "Loading",
  saving: "Saving",
  saved: "Saved",
  error: "Storage error",
};

export function EditorWidget() {
  const {
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
  } = useEditorRuntime();
  const zoomPercent = `${Math.round(zoom * 100)}%`;
  const showObjectSettings = isObjectTool(activeTool) || hasSelection;

  return (
    <main className="app-shell">
      <header className="top-bar" aria-label="Whiteboard controls">
        <section className="brand" aria-label="Application">
          <img className="brand__mark" src="/logo.svg" alt="" aria-hidden="true" />
          <span className="brand__name">SketchBoard</span>
        </section>

        <ToggleGroup
          aria-label="Drawing tools"
          className="toolbar"
          onValueChange={(value) => {
            const [nextTool] = value as Tool[];

            if (nextTool) {
              setTool(nextTool);
            }
          }}
          spacing={1}
          value={[activeTool]}
          variant="outline"
        >
          {TOOLS.map((tool) => (
            <Tooltip key={tool.id}>
              <TooltipTrigger
                delay={0}
                render={
                  <ToggleGroupItem
                    aria-label={tool.label}
                    className="icon-button editor-tool-button"
                    data-tool={tool.id}
                    value={tool.id}
                  />
                }
              >
                <EditorIcon name={tool.id} />
                <span aria-hidden="true" className="editor-tool-button__shortcut">
                  {tool.numericShortcut}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{getToolTitle(tool)}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>

        <section className="actions" aria-label="Scene actions">
          <Badge
            className="save-state"
            data-save-state
            data-state={saveState}
            variant={saveState === "error" ? "destructive" : "secondary"}
          >
            {saveStateLabels[saveState]}
          </Badge>
          <Separator orientation="vertical" />
          <Button
            className="text-button"
            data-clear
            onClick={clearScene}
            type="button"
            variant="ghost"
          >
            <EditorIcon iconPosition="inline-start" name="clear" />
            <span>Clear</span>
          </Button>
          <Button
            className="text-button text-button--primary"
            data-export
            onClick={exportPng}
            type="button"
          >
            <EditorIcon iconPosition="inline-start" name="export" />
            <span>PNG</span>
          </Button>
        </section>
      </header>

      <div className="canvas-frame">
        <canvas
          ref={canvasRef}
          aria-label="Drawing canvas"
          className="drawing-canvas"
          data-canvas
          data-panning={String(isPanning)}
          data-tool={activeTool}
        />
        <textarea
          ref={textEditorRef}
          className="inline-text-editor"
          data-text-editor
          rows={1}
          spellCheck={false}
        />
        <ObjectSettingsPanel
          fillColor={fillColor}
          hasSelection={hasSelection}
          lineWidth={lineWidth}
          setFillColor={setFillColor}
          setLineWidth={setLineWidth}
          setStrokeColor={setStrokeColor}
          strokeColor={strokeColor}
          updateSelectionLayer={updateSelectionLayer}
          visible={showObjectSettings}
        />
        <aside className="help-panel" aria-label="Canvas tips">
          <span>Wheel moves, Ctrl/Cmd wheel or pinch zooms</span>
        </aside>
        <section aria-label="Zoom controls" className="zoom-panel">
          <Button
            aria-label="Zoom out"
            className="icon-button zoom-panel__button"
            data-zoom-out
            onClick={zoomOut}
            title="Zoom out"
            type="button"
            variant="ghost"
          >
            <span aria-hidden="true">-</span>
          </Button>
          <Button
            aria-label={`Reset zoom to 100%. Current zoom ${zoomPercent}`}
            className="zoom-panel__value"
            data-zoom-reset
            onClick={resetZoom}
            title="Reset zoom"
            type="button"
            variant="ghost"
          >
            {zoomPercent}
          </Button>
          <Button
            aria-label="Zoom in"
            className="icon-button zoom-panel__button"
            data-zoom-in
            onClick={zoomIn}
            title="Zoom in"
            type="button"
            variant="ghost"
          >
            <span aria-hidden="true">+</span>
          </Button>
        </section>
      </div>
    </main>
  );
}
