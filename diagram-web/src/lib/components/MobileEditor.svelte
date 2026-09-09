<script lang="ts">
  import type { EditorProps } from '$/types';
  import { validatedState } from '$/util/state.svelte';
  import { json, jsonLanguage } from '@codemirror/lang-json';
  import { markdown } from '@codemirror/lang-markdown';
  import { yamlFrontmatter } from '@codemirror/lang-yaml';
  import { language } from '@codemirror/language';
  import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark';
  import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light';
  import { basicSetup } from 'codemirror';
  import { mode } from 'mode-watcher';
  import { onMount } from 'svelte';
  import { yCollab } from 'y-codemirror.next';

  let editorView: EditorView | undefined;
  let editorReady = $state(false);
  let handledSelectionId = -1;
  let editorContainer: HTMLDivElement;
  // Deliberately not $state: the sync effect below both reads and writes it,
  // so a reactive currentText would make every keystroke re-run the effect
  // against the not-yet-revalidated state and revert the user's input.
  let currentText = '';
  const themeCompartment = new Compartment();
  const languageCompartment = new Compartment();
  const collaborationCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();

  const { onUpdate, collaboration, selectionRequest }: EditorProps = $props();

  $effect(() => {
    editorView?.dispatch({
      effects: themeCompartment.reconfigure(mode.current === 'dark' ? vsCodeDark : vsCodeLight)
    });
  });

  onMount(() => {
    editorView = new EditorView({
      state: EditorState.create({
        doc: currentText,
        extensions: [
          basicSetup,
          collaborationCompartment.of([]),
          languageCompartment.of([]),
          readOnlyCompartment.of([
            EditorState.readOnly.of(collaboration?.readOnly ?? false),
            EditorView.editable.of(!(collaboration?.readOnly ?? false))
          ]),
          themeCompartment.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newText = update.state.doc.toString();
              if (currentText === newText) {
                return;
              }
              currentText = newText;
              onUpdate(newText);
            }
          }),
          EditorView.theme({
            '&.cm-focused': {
              outline: 'none'
            },
            '&.cm-editor': {
              height: '100%'
            },
            '&.cm-scroller': {
              overflow: 'auto'
            }
          })
        ]
      }),
      parent: editorContainer
    });
    editorReady = true;

    return () => {
      editorView?.destroy();
    };
  });

  $effect(() => {
    const { editorMode, code, mermaid } = validatedState.current;
    const text = editorMode === 'code' ? code : mermaid;
    if (!editorReady || !editorView) {
      return;
    }
    if (!collaboration) {
      currentText = text;
      editorView.dispatch({
        changes: {
          from: 0,
          to: editorView.state.doc.length,
          insert: text
        }
      });
    }
    const stateLanguage = editorView.state.facet(language);
    const isStateJson = stateLanguage === jsonLanguage;
    const isCodeJson = editorMode === 'config';
    if (stateLanguage && isStateJson === isCodeJson) {
      return;
    }
    editorView.dispatch({
      effects: [
        languageCompartment.reconfigure(
          isCodeJson ? json() : yamlFrontmatter({ content: markdown() })
        ),
        collaborationCompartment.reconfigure(
          collaboration
            ? yCollab(
                isCodeJson ? collaboration.config : collaboration.code,
                collaboration.awareness
              )
            : []
        ),
        readOnlyCompartment.reconfigure([
          EditorState.readOnly.of(collaboration?.readOnly ?? false),
          EditorView.editable.of(!(collaboration?.readOnly ?? false))
        ])
      ]
    });
  });

  $effect(() => {
    const request = selectionRequest;
    if (
      !request ||
      request.id === handledSelectionId ||
      validatedState.current.editorMode !== 'code' ||
      !editorReady ||
      !editorView
    ) {
      return;
    }
    const end = Math.min(request.end, editorView.state.doc.length);
    const start = Math.min(request.start, end);
    editorView.dispatch({
      effects: EditorView.scrollIntoView(EditorSelection.range(start, end), { y: 'center' }),
      selection: { anchor: start, head: end }
    });
    editorView.focus();
    handledSelectionId = request.id;
  });
</script>

<div bind:this={editorContainer} class="size-full"></div>
