import type { CollaborationIdentity } from './collaboration/CollaborativeDocumentController';
import type { PublicLinkMode } from './types';

const GUEST_ID_KEY = 'mermaid-public-share-guest-id';

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
  createId: () => string = () => crypto.randomUUID()
): CollaborationIdentity => {
  let id = storage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = createId();
    storage.setItem(GUEST_ID_KEY, id);
  }
  return { displayName: `Guest ${id.slice(0, 4).toUpperCase()}`, id: `guest:${id}` };
};
