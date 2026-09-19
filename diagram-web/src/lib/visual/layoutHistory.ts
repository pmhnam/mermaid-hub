import type { VisualLayout, VisualLayoutOffset } from './layout';

type Change =
  | { key: string; kind: 'node'; before?: VisualLayoutOffset; after?: VisualLayoutOffset }
  | { key: string; kind: 'edge'; before?: VisualLayoutOffset[]; after?: VisualLayoutOffset[] };
interface Entry {
  engine: VisualLayout['engine'];
  changes: Change[];
}
const equal = (a?: VisualLayoutOffset, b?: VisualLayoutOffset): boolean =>
  (a?.x ?? 0) === (b?.x ?? 0) && (a?.y ?? 0) === (b?.y ?? 0);
const equalRoute = (a?: VisualLayoutOffset[], b?: VisualLayoutOffset[]): boolean =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Store only locally changed offsets. Undo never replaces a collaborator's newer position. */
export class LayoutHistory {
  private past: Entry[] = [];
  private future: Entry[] = [];
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  clear(): void {
    this.past = [];
    this.future = [];
  }
  record(before: VisualLayout, after: VisualLayout): boolean {
    if (before.engine !== after.engine) {
      this.clear();
      return false;
    }
    const changes: Change[] = [
      ...new Set([...Object.keys(before.offsets), ...Object.keys(after.offsets)])
    ]
      .filter((key) => !equal(before.offsets[key], after.offsets[key]))
      .map((key) => ({
        after: after.offsets[key],
        before: before.offsets[key],
        key,
        kind: 'node'
      }));
    for (const key of new Set([
      ...Object.keys(before.edgeRoutes ?? {}),
      ...Object.keys(after.edgeRoutes ?? {})
    ])) {
      if (!equalRoute(before.edgeRoutes?.[key], after.edgeRoutes?.[key]))
        changes.push({
          after: after.edgeRoutes?.[key],
          before: before.edgeRoutes?.[key],
          key,
          kind: 'edge'
        });
    }
    if (!changes.length) return false;
    this.past.push({ changes, engine: after.engine });
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    return true;
  }
  step(current: VisualLayout, redo = false): VisualLayout | undefined {
    const entry = (redo ? this.future : this.past).pop();
    if (!entry || entry.engine !== current.engine) return;
    const offsets = { ...current.offsets };
    const edgeRoutes = { ...current.edgeRoutes };
    const applied: Change[] = [];
    for (const change of entry.changes) {
      if (change.kind === 'node') {
        if (!equal(offsets[change.key], redo ? change.before : change.after)) continue;
        const next = redo ? change.after : change.before;
        if (next) offsets[change.key] = next;
        else Reflect.deleteProperty(offsets, change.key);
      } else {
        if (!equalRoute(edgeRoutes[change.key], redo ? change.before : change.after)) continue;
        const next = redo ? change.after : change.before;
        if (next) edgeRoutes[change.key] = next;
        else Reflect.deleteProperty(edgeRoutes, change.key);
      }
      applied.push(change);
    }
    if (!applied.length) return;
    (redo ? this.past : this.future).push({ ...entry, changes: applied });
    return {
      ...current,
      ...(current.edgeRoutes || Object.keys(edgeRoutes).length ? { edgeRoutes } : {}),
      mode: 'manual',
      offsets
    };
  }
}
