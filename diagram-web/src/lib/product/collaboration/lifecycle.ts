import type { CollaborationTicket } from '../types';

export const reconnectDelay = (attempt: number): number =>
  Math.min(10_000, 250 * 2 ** Math.min(attempt, 6));

export const websocketProviderAddress = (
  apiBaseUrl: string,
  websocketPath: string,
  browserOrigin: string
): { room: string; serverUrl: string } => {
  const url = new URL(websocketPath, apiBaseUrl || browserOrigin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const segments = url.pathname.split('/').filter(Boolean);
  const room = segments.pop();
  if (!room) throw new Error('Collaboration websocket path must include a room');
  url.pathname = `/${segments.join('/')}`;
  url.search = '';
  url.hash = '';
  return { room, serverUrl: url.toString().replace(/\/$/, '') };
};

export type TicketLoader = () => Promise<CollaborationTicket>;
