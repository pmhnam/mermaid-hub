import type { CollaborationIdentity } from './collaboration/CollaborativeDocumentController';
import type { PublicLinkMode } from './types';

const ADJECTIVES = [
  'Bright',
  'Calm',
  'Clever',
  'Curious',
  'Gentle',
  'Jolly',
  'Kind',
  'Lively',
  'Nimble',
  'Quiet',
  'Swift',
  'Witty'
];
const ANIMALS = [
  'Badger',
  'Dolphin',
  'Falcon',
  'Fox',
  'Koala',
  'Lynx',
  'Otter',
  'Panda',
  'Raven',
  'Robin',
  'Tiger',
  'Wolf'
];

const friendlyGuestName = (id: string): string => {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return `${ADJECTIVES[hash % ADJECTIVES.length]} ${ANIMALS[Math.floor(hash / ADJECTIVES.length) % ANIMALS.length]}`;
};

export const publicShareToken = (hash: string): string | null => {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!fragment) return null;
  if (fragment.startsWith('token=')) return new URLSearchParams(fragment).get('token');
  return decodeURIComponent(fragment);
};

export const isPublicLinkMode = (mode: unknown): mode is PublicLinkMode =>
  mode === 'public_read' || mode === 'public_edit';

export const publicGuestIdentity = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  diagramId: string,
  createId: () => string = () => crypto.randomUUID()
): CollaborationIdentity => {
  const storageKey = `mermaid-public-share-guest:${diagramId}`;
  let id = storage.getItem(storageKey);
  if (!id) {
    id = createId();
    storage.setItem(storageKey, id);
  }
  return { displayName: friendlyGuestName(id), id: `guest:${id}` };
};
