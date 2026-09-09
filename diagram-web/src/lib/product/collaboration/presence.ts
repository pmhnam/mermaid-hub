import type { WebsocketProvider } from 'y-websocket';

export interface PresenceUser {
  color: string;
  displayName: string;
  name?: string;
  userId: string;
}

export interface PreviewCursorPosition {
  revision: string;
  x: number;
  y: number;
}

export interface RemotePreviewCursor extends PresenceUser, PreviewCursorPosition {
  clientId: number;
}

const COLORS = ['#e11d48', '#7c3aed', '#0284c7', '#059669', '#d97706', '#db2777'];

export const presenceColor = (userId: string): string => {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return COLORS[hash % COLORS.length];
};

export const presenceInitials = (displayName: string): string => {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words.at(-1);
  return (
    words.length > 1 && first && last ? `${first[0]}${last[0]}` : first?.slice(0, 2) || '?'
  ).toUpperCase();
};

export const presenceRevision = (code: string, config: string): string => {
  let canonicalConfig = config;
  try {
    canonicalConfig = JSON.stringify(JSON.parse(config));
  } catch {
    // Invalid config is already handled by the editor validation pipeline.
  }
  let hash = 2166136261;
  for (const character of `${code}\u0000${canonicalConfig}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const readUser = (value: unknown): PresenceUser | null => {
  const user = value as Partial<PresenceUser> | undefined;
  if (!user || typeof user.userId !== 'string' || typeof user.displayName !== 'string') return null;
  const userId = user.userId.slice(0, 128);
  const displayName = user.displayName.trim().slice(0, 48);
  if (!userId || !displayName) return null;
  return { color: presenceColor(userId), displayName, name: displayName, userId };
};

export const readPresence = (
  awareness: WebsocketProvider['awareness'],
  localClientId: number
): PresenceUser[] => {
  const users = new Map<string, PresenceUser>();
  for (const [clientId, state] of awareness.getStates()) {
    const user = readUser(state.user);
    if (clientId !== localClientId && user) users.set(user.userId, user);
  }
  return [...users.values()].toSorted((left, right) =>
    left.displayName.localeCompare(right.displayName)
  );
};

export const readPreviewCursors = (
  awareness: WebsocketProvider['awareness'],
  localClientId: number
): RemotePreviewCursor[] => {
  const cursors: RemotePreviewCursor[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === localClientId) continue;
    const user = readUser(state.user);
    const cursor = state.previewCursor as Partial<PreviewCursorPosition> | undefined;
    if (
      !user ||
      !cursor ||
      typeof cursor.revision !== 'string' ||
      typeof cursor.x !== 'number' ||
      typeof cursor.y !== 'number' ||
      !Number.isFinite(cursor.x) ||
      !Number.isFinite(cursor.y)
    ) {
      continue;
    }
    cursors.push({
      ...user,
      clientId,
      revision: cursor.revision.slice(0, 32),
      x: cursor.x,
      y: cursor.y
    });
  }
  return cursors;
};
