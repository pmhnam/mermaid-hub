import type { WebsocketProvider } from 'y-websocket';

export interface PresenceUser {
  color: string;
  displayName: string;
  userId: string;
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

export const readPresence = (
  awareness: WebsocketProvider['awareness'],
  localClientId: number
): PresenceUser[] => {
  const users = new Map<string, PresenceUser>();
  for (const [clientId, state] of awareness.getStates()) {
    const user = state.user as Partial<PresenceUser> | undefined;
    if (
      clientId !== localClientId &&
      user &&
      typeof user.userId === 'string' &&
      typeof user.displayName === 'string' &&
      typeof user.color === 'string'
    ) {
      users.set(user.userId, user as PresenceUser);
    }
  }
  return [...users.values()].toSorted((left, right) =>
    left.displayName.localeCompare(right.displayName)
  );
};
