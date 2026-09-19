<script lang="ts">
  import { sourcePosition } from '$/util/sourcePosition';
  import { publishSourceCursor } from '$/util/canvasEvents';
  import type { EditorProps } from '$/types';
  import { env } from '$/util/env';
  import { urls, validatedState } from '$/util/state.svelte';
  import { AIPromptViewZoneManager } from '$lib/util/AIPromptViewZoneManager';
  import { initEditor } from '$lib/util/monacoExtra';
  import { errorDebug } from '$lib/util/util';
  import { mode } from 'mode-watcher';
  import * as monaco from 'monaco-editor';
  import monacoEditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
  import monacoJsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
  import { onMount } from 'svelte';
  import { MonacoBinding } from 'y-monaco';
  import AIPromptPopup from './AIPromptPopup.svelte';

  const { onUpdate, collaboration, selectionRequest }: EditorProps = $props();

  let divElement: HTMLDivElement | undefined = $state();
  let aiPromptPopupElement: HTMLDivElement | undefined = $state();
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let editorReady = $state(false);
  let handledSelectionId = -1;
  let collaborationBindings: MonacoBinding[] = [];
  let editorOptions = {
    minimap: {
      enabled: false
    },
    overviewRulerLanes: 0,
    glyphMargin: true,
    lineNumbersMinChars: 4
  } satisfies monaco.editor.IStandaloneEditorConstructionOptions;
  let currentText = '';
  let isUpdatingFromState = false;
  let showPopup = $state(false);
  let popupPosition = $state({ top: 0, lineNumber: 0 });
  let decorationsCollection: monaco.editor.IEditorDecorationsCollection | undefined;
  let input = $state('');
  let lastMouseLine = 0;
  const aiPromptManager = new AIPromptViewZoneManager();

  const applyEditorTheme = (currentMode: typeof mode.current) => {
    if (!editor) return;
    monaco.editor.setTheme(`mermaid${currentMode === 'dark' ? '-dark' : ''}`);
    divElement?.classList.toggle('mermaid-dark', currentMode === 'dark');
  };

  $effect(() => {
    applyEditorTheme(mode.current);
  });

  const jsonModel = monaco.editor.createModel(
    '',
    'json',
    monaco.Uri.parse('internal://config.json')
  );
  const mermaidModel = monaco.editor.createModel(
    '',
    'mermaid',
    monaco.Uri.parse('internal://mermaid.mmd')
  );

  const renderAIPromptGutterGlyphIcon = () => {
    decorationsCollection?.clear();
    if (!editor || showPopup) {
      return;
    }
    const model = editor.getModel();
    if (!model) {
      return;
    }

    if (lastMouseLine > 0 && model.id === mermaidModel.id) {
      decorationsCollection?.set([
        {
          range: new monaco.Range(lastMouseLine, 1, lastMouseLine, 1),
          options: {
            glyphMarginClassName: 'suggestion-icon'
          }
        }
      ]);
    }
  };

  const closePopup = () => {
    showPopup = false;
    input = '';
    aiPromptManager.hide();
    renderAIPromptGutterGlyphIcon();
  };

  const toggleAIPopup = (lineNumber: number) => {
    if (!divElement || !aiPromptPopupElement) return;
    popupPosition = {
      top: 0,
      lineNumber
    };
    showPopup = !showPopup;
    if (showPopup) {
      aiPromptManager.show(popupPosition.lineNumber, aiPromptPopupElement, 100);
      editor?.setSelection(new monaco.Range(0, 0, 0, 0));
    } else {
      aiPromptManager.hide();
    }
    renderAIPromptGutterGlyphIcon();
  };

  onMount(() => {
    self.MonacoEnvironment = {
      getWorker(_, label) {
        if (label === 'json') {
          return new monacoJsonWorker();
        }
        return new monacoEditorWorker();
      }
    };

    if (!divElement) {
      throw new Error('divEl is undefined');
    }

    monaco.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      enableSchemaRequest: true,
      schemas: [
        {
          fileMatch: ['config.json'],
          uri: `${env.docsUrl}/schemas/config.schema.json`
        }
      ]
    });

    initEditor(monaco);
    errorDebug();
    editor = monaco.editor.create(divElement, editorOptions);
    editorReady = true;
    if (collaboration) {
      const editors = new Set([editor]);
      collaborationBindings = [
        new MonacoBinding(collaboration.code, mermaidModel, editors, collaboration.awareness),
        new MonacoBinding(collaboration.config, jsonModel, editors, collaboration.awareness)
      ];
      editor.updateOptions({ readOnly: collaboration.readOnly });
    }
    aiPromptManager.setEditor(editor);
    decorationsCollection = editor.createDecorationsCollection([]);

    editor.onMouseDown((e) => {
      const isGutter = e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
      if (isGutter && e.target.position?.lineNumber === lastMouseLine && lastMouseLine > 0) {
        e.event.preventDefault();
        e.event.stopPropagation();
        toggleAIPopup(e.target.position.lineNumber);
      }
    });

    editor.onDidChangeModelContent(({ isFlush }) => {
      const newText = editor?.getValue();
      if (newText === undefined || currentText === newText || isFlush || isUpdatingFromState) {
        return;
      }
      currentText = newText;
      onUpdate(currentText);
    });
    editor.onDidChangeCursorSelection((event) => {
      if (isUpdatingFromState || !editor?.hasTextFocus() || editor.getModel() !== mermaidModel)
        return;
      const position = event.selection.getPosition();
      publishSourceCursor({
        code: mermaidModel.getValue(),
        column: position.column,
        lineNumber: position.lineNumber
      });
    });

    editor.onMouseMove((e) => {
      if (!editor) return;
      if (showPopup) return;
      if (editor.getModel()?.id !== mermaidModel.id) return;

      lastMouseLine = e.target.position?.lineNumber ?? 0;
      renderAIPromptGutterGlyphIcon();
    });

    editor.onMouseLeave(() => {
      lastMouseLine = 0;
      renderAIPromptGutterGlyphIcon();
    });

    applyEditorTheme(mode.current);

    const resizeObserver = new ResizeObserver((entries) => {
      editor?.layout({
        height: entries[0].contentRect.height,
        width: entries[0].contentRect.width
      });
    });

    if (divElement.parentElement) {
      resizeObserver.observe(divElement);
    }

    renderAIPromptGutterGlyphIcon();

    return () => {
      resizeObserver.disconnect();
      for (const binding of collaborationBindings) binding.destroy();
      jsonModel.dispose();
      mermaidModel.dispose();
      aiPromptManager.destroy();
      editor?.dispose();
    };
  });

  $effect(() => {
    const { errorMarkers, editorMode, code, mermaid } = validatedState.current;
    if (!editorReady || !editor) {
      return;
    }

    const model = editorMode === 'code' ? mermaidModel : jsonModel;

    if (editor.getModel()?.id !== model.id) {
      editor.setModel(model);
      renderAIPromptGutterGlyphIcon();
    }

    // Clear decorations if not in 'code' mode, or if the model changes
    if (editorMode !== 'code' || editor.getModel()?.id !== mermaidModel.id) {
      decorationsCollection?.clear();
    }

    // Update editor text if it's different
    const newText = editorMode === 'code' ? code : mermaid;
    if (!collaboration && newText !== currentText) {
      isUpdatingFromState = true;
      try {
        editor.setScrollTop(0);
        editor.pushUndoStop();
        editor.executeEdits('updateCode', [
          {
            range: model.getFullModelRange(),
            text: newText
          }
        ]);
        editor.pushUndoStop();
        currentText = newText;
      } finally {
        isUpdatingFromState = false;
      }
      renderAIPromptGutterGlyphIcon();
    }

    // Display/clear errors
    monaco.editor.setModelMarkers(model, 'mermaid', errorMarkers);
    editor.updateOptions({ readOnly: collaboration?.readOnly ?? false });
  });

  $effect(() => {
    const request = selectionRequest;
    if (
      !request ||
      request.id === handledSelectionId ||
      validatedState.current.editorMode !== 'code' ||
      !editorReady ||
      !editor
    ) {
      return;
    }
    editor.setModel(mermaidModel);
    const source = request.sourceCode ?? validatedState.current.code;
    const start = sourcePosition(source, request.start);
    const end = sourcePosition(source, request.end);
    const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
    editor.setSelection(range);
    editor.revealRangeInCenter(range);
    editor.focus();
    handledSelectionId = request.id;
  });
</script>

<div class="relative h-full grow overflow-hidden">
  <div bind:this={divElement} id="editor" class="h-full w-full"></div>
  <div bind:this={aiPromptPopupElement}>
    <AIPromptPopup
      show={showPopup}
      bind:input
      onHeightChange={(height) => aiPromptManager.updateHeight(height)}
      onClose={closePopup}
      onTryFree={() => {
        window.open(urls.current.workspaceImport, '_blank', 'noopener');
        closePopup();
      }} />
  </div>
</div>

<style>
  :global(.suggestion-icon) {
    background-color: #e8eaf9;
    width: 20px !important;
    height: 20px !important;
    margin-left: 4px;
    background-image: url('/icons/use-chat.svg');
    background-size: 16px 16px;
    background-repeat: no-repeat;
    background-position: center;
    border-radius: 4px;
    cursor: pointer;
  }

  :global(#editor.mermaid-dark .suggestion-icon) {
    background-color: #2e4d6b;
    background-image: url('/icons/use-chat-dark.svg');
  }

  :global(.yRemoteSelection) {
    background-color: color-mix(in srgb, #0ea5e9 28%, transparent);
  }

  :global(.yRemoteSelectionHead) {
    border-left: 2px solid #0284c7;
    box-sizing: border-box;
    height: 100%;
    position: absolute;
  }
</style>
