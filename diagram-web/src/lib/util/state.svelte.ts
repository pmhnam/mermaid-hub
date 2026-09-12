import { defaultState } from '$/constants';
import type { State, ValidatedState } from '$/types';
import { resolve } from '$app/paths';
import { debounce, get as lodashGet } from 'lodash-es';
import type { MermaidConfig } from 'mermaid';
import { untrack } from 'svelte';
import { env } from './env';
import {
  extractErrorLineText,
  findMostRelevantLineNumber,
  replaceLineNumberInErrorMessage,
  sourceRangeFromError
} from './errorHandling';
import { parse } from './mermaid';
import { readJSON, writeJSON } from './persist.svelte';
import { findUnsafeConfigPaths, stripConfigPaths } from './sanitize';
import { deserializeState, pakoSerde, serializeState } from './serde';
import { errorDebug, formatJSON } from './util';

export { defaultState };

const urlParseFailedState = `flowchart TD
    A[Loading URL failed. We can try to figure out why.] -->|Decode JSON| B(Please check the console to see the JSON and error details.)
    B --> C{Is the JSON correct?}
    C -->|Yes| D(Please Click here to Raise an issue in github.<br/>Including the broken link in the issue <br/> will speed up the fix.)
    C -->|No| E{Did someone <br/>send you this link?}
    E -->|Yes| F[Ask them to send <br/>you the complete link]
    E -->|No| G{Did you copy <br/> the complete URL?}
    G --> |Yes| D
    G --> |"No :("| H(Try using the Timeline tab in History <br/>from same browser you used to create the diagram.)
    click D href "https://github.com/mermaid-js/mermaid-live-editor/issues/new?assignees=&labels=bug&template=bug_report.md&title=Broken%20link" "Raise issue"`;

const CODE_STORE_KEY = 'codeStore';

// The single mutable input state; only update() below may write to it.
// The fallback is cloned so mutations never write through to defaultState.
const input = $state<State>(readJSON(CODE_STORE_KEY, { ...defaultState }));

// inputState is shared externally when exporting via URL, History, etc.
// It is reactive for reads; the read-only type keeps writes inside this
// module, where update() persists and re-validates every change.
export const inputState: Readonly<State> = input;

const validatedStateOf = (state: State, serialized: string): ValidatedState => ({
  ...state,
  editorMode: state.editorMode ?? 'code',
  error: undefined,
  errorMarkers: [],
  serialized
});

const initialState = $state.snapshot(input) as State;
// Only ever replaced wholesale, so raw (shallow) reactivity is enough.
let validatedCurrent = $state.raw<ValidatedState>(
  validatedStateOf(initialState, serializeState(initialState))
);

let lastDiagramType = '';

const processState = async (state: State) => {
  const processed = validatedStateOf(state, '');
  try {
    processed.serialized = serializeState(state);
    const { diagramType } = await parse(state.code);
    processed.diagramType = diagramType;
    if (lastDiagramType === 'zenuml' && diagramType !== lastDiagramType) {
      // Temp Hack to refresh page after displaying ZenUML.
      setTimeout(() => window.location.reload(), 500);
    }
    lastDiagramType = diagramType;
  } catch (error) {
    processed.error = error as Error;
    processed.errorSource = 'code';
    errorDebug();
    console.error(error);
    const errorString = processed.error.toString();
    const errorLineText = extractErrorLineText(errorString);
    const realLineNumber = findMostRelevantLineNumber(errorLineText, state.code);
    if (realLineNumber !== -1) {
      processed.error = new Error(replaceLineNumberInErrorMessage(errorString, realLineNumber));
    }
    processed.errorRange = sourceRangeFromError(error, state.code, processed.error.message);
    if (processed.errorRange) {
      const startLine = state.code.slice(0, processed.errorRange.start).split('\n').length;
      const endLine = state.code.slice(0, processed.errorRange.end).split('\n').length;
      processed.errorMarkers = [
        {
          endColumn:
            processed.errorRange.end - state.code.lastIndexOf('\n', processed.errorRange.end - 1),
          endLineNumber: endLine,
          message: processed.error.message || 'Syntax error',
          severity: 8,
          startColumn:
            processed.errorRange.start -
            state.code.lastIndexOf('\n', processed.errorRange.start - 1),
          startLineNumber: startLine
        }
      ];
    }
  }

  if (processed.errorSource === 'code') {
    return processed;
  }

  try {
    JSON.parse(state.mermaid);
  } catch (error) {
    processed.error = error as Error;
    processed.errorSource = 'config';
    console.error(error);
  }
  return processed;
};

// Replaces the old URL-hash store subscription; assigned by initURLSubscription.
let updateHash: ReturnType<typeof debounce> | undefined;
let processRevision = 0;

// Persist the current input state and asynchronously re-validate it,
// publishing the result to `validatedState` (and the URL hash, once
// initURLSubscription has run). Only called from update(), which suppresses
// dependency tracking.
const persistAndProcess = (): void => {
  const snapshot = $state.snapshot(input) as State;
  writeJSON(CODE_STORE_KEY, snapshot);
  const revision = ++processRevision;
  void processState(snapshot).then((processed) => {
    if (revision !== processRevision) return;
    validatedCurrent = processed;
    updateHash?.(processed.serialized);
  });
};

// The single mutation gateway: every update function funnels its writes
// through here. The mutator runs untracked so effects that call an update
// function never subscribe to the input state it reads, and the trailing
// persist + re-validate cannot be forgotten by a new update function.
const update = (mutate: (state: State) => void): void => {
  untrack(() => {
    mutate(input);
    persistAndProcess();
  });
};

// All internal reads should be done via validatedState, but it should not be
// persisted/shared externally.
export const validatedState = {
  get current(): ValidatedState {
    return validatedCurrent;
  }
};

const urlsCurrent = $derived.by(() => {
  const { code, serialized } = validatedCurrent;
  const { krokiRendererUrl, rendererUrl } = env;
  const png = rendererUrl ? `${rendererUrl}/img/${serialized}?type=png` : '';
  return {
    kroki: krokiRendererUrl ? `${krokiRendererUrl}/mermaid/svg/${pakoSerde.serialize(code)}` : '',
    mdCode: png ? `[![](${png})](${window.location.href})` : '',
    new: `${resolve('/edit', {})}#${serializeState(defaultState)}`,
    png,
    svg: rendererUrl ? `${rendererUrl}/svg/${serialized}` : '',
    view: `${resolve('/view', {})}#${serialized}`,
    workspaceImport: `${resolve('/import', {})}#${serialized}`
  };
});

export const urls = {
  get current() {
    return urlsCurrent;
  }
};

/**
 * Asks the user for confirmation if the config contains settings that might
 * pose security risks, such as a relaxed `securityLevel`.
 *
 * @param config - The Mermaid configuration to sanitize.
 * @returns The sanitized Mermaid configuration as a JSON string.
 */
export const sanitizeConfig = (config: string | MermaidConfig) => {
  const mermaidConfig: MermaidConfig =
    typeof config === 'string' ? (JSON.parse(config) as MermaidConfig) : config;

  const unsafePaths = findUnsafeConfigPaths(mermaidConfig);

  if (
    unsafePaths.length > 0 &&
    confirm(
      `Removing ${unsafePaths
        .map((unsafePath) => {
          return `${JSON.stringify(unsafePath.join('.'))}: ${JSON.stringify(lodashGet(mermaidConfig, unsafePath))}`;
        })
        .join(
          ',\n'
        )} from the config for safety.\nClick Cancel if you trust the source of this Diagram.`
    )
  ) {
    stripConfigPaths(mermaidConfig, unsafePaths);
  }
  return formatJSON(mermaidConfig);
};

export const loadState = (data: string): void => {
  console.log(`Loading '${data}'`);
  update((state) => {
    let next: State;
    try {
      next = deserializeState(data);
      next.mermaid = sanitizeConfig(next.mermaid || defaultState.mermaid);
    } catch (error) {
      next = $state.snapshot(state) as State;
      if (data) {
        console.error('Init error', error);
        next.code = urlParseFailedState;
        next.mermaid = defaultState.mermaid;
      }
    }
    applyPartial(state, next);
  });
};

let renderCount = 0;
const applyPartial = (state: State, newState: Partial<State>): void => {
  renderCount++;
  Object.assign(state, newState, { renderCount });
};

export const updateCodeStore = (newState: Partial<State>): void => {
  update((state) => applyPartial(state, newState));
};

export const updateCode = (
  code: string,
  {
    updateDiagram = false,
    resetPanZoom = false
  }: { updateDiagram?: boolean; resetPanZoom?: boolean } = {}
): void => {
  errorDebug();

  update((state) => {
    if (resetPanZoom) {
      state.pan = undefined;
      state.zoom = undefined;
    }
    state.code = code;
    state.updateDiagram = updateDiagram;
  });
};

export const updateConfig = (config: string): void => {
  updateCodeStore({ mermaid: config });
};

export const toggleDarkTheme = (dark: boolean): void => {
  update((state) => {
    const config = JSON.parse(state.mermaid) as MermaidConfig;
    if (!config.theme || ['dark', 'default'].includes(config.theme)) {
      config.theme = dark ? 'dark' : 'default';
    }
    state.mermaid = formatJSON(config);
  });
};

// Replaces the whole input state (e.g. when restoring a history entry),
// dropping keys the next state does not define.
export const replaceInputState = (next: State): void => {
  update((state) => {
    for (const key of Object.keys(state)) {
      if (!(key in next)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- full-replace semantics
        delete (state as unknown as Record<string, unknown>)[key];
      }
    }
    Object.assign(state, next);
  });
};

export const initURLSubscription = (): void => {
  updateHash = debounce((serialized: string) => {
    history.replaceState(undefined, '', `#${serialized}`);
  }, 250);
  updateHash(validatedCurrent.serialized);
};

export const disableURLSubscription = (): void => {
  updateHash?.cancel();
  updateHash = undefined;
};

export const verifyState = (): void => {
  update((state) => applyPartial(state, state.panZoom ? {} : { panZoom: true }));
};
