import { describe, expect, it } from 'vitest';
import { reconnectDelay, websocketProviderAddress } from './lifecycle';

describe('collaboration lifecycle helpers', () => {
  it('builds the exact backend websocket path for y-websocket room joining', () => {
    expect(
      websocketProviderAddress('https://api.example.test', '/ws/collaboration', 'https://app.test')
    ).toEqual({ room: 'collaboration', serverUrl: 'wss://api.example.test/ws' });
  });

  it('bounds reconnect backoff', () => {
    expect(reconnectDelay(0)).toBe(250);
    expect(reconnectDelay(20)).toBe(10_000);
  });
});
