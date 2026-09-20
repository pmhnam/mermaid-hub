import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  ArrangeProvider,
  ArrangeService,
  validateAssignments,
} from './arrange.service.js';
import type { ArrangeDto } from './arrange.dto.js';

const input: ArrangeDto = {
  instruction: 'Group by service',
  tables: [
    { id: 'billing.users', fields: [], service: 'Billing' },
    { id: 'identity.users', fields: [] },
  ],
  edges: [{ source: 'billing.users', target: 'identity.users' }],
};
const assignments = [
  { tableId: 'billing.users', service: 'Wrong', database: 'billing' },
  { tableId: 'identity.users', service: 'Identity', database: 'identity' },
];

describe('AI arrangement', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('preserves explicit ownership and distinguishes identical table names in different databases', () => {
    expect(validateAssignments(assignments, input)[0].service).toBe('Billing');
    expect(validateAssignments(assignments, input)).toHaveLength(2);
  });
  it('rejects omitted, invented, duplicate and malformed table assignments', () => {
    for (const result of [
      assignments.slice(1),
      [...assignments, assignments[0]],
      [assignments[0], assignments[0]],
      [{ ...assignments[0], tableId: 'invented' }, assignments[1]],
      [{ ...assignments[0], database: '' }, assignments[1]],
    ]) {
      expect(() => validateAssignments(result, input)).toThrow();
    }
  });
  it('rejects invalid graph before calling provider', async () => {
    const suggest = vi.fn();
    const service = new ArrangeService({
      suggest,
    } as unknown as ArrangeProvider);
    await expect(
      service.arrange(
        { ...input, edges: [{ source: 'missing', target: 'billing.users' }] },
        'user',
      ),
    ).rejects.toThrow('endpoints');
    expect(suggest).not.toHaveBeenCalled();
  });
  it('releases the per-user lock after provider failure', async () => {
    const suggest = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(assignments);
    const service = new ArrangeService({
      suggest,
    } as unknown as ArrangeProvider);
    await expect(service.arrange(input, 'user')).rejects.toThrow('timeout');
    await expect(service.arrange(input, 'user')).resolves.toHaveProperty(
      'assignments',
    );
  });
  it('requires configuration and hides upstream error details', async () => {
    await expect(
      new ArrangeProvider(new ConfigService()).suggest(input),
    ).rejects.toThrow('not configured');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('private upstream details', { status: 401 }),
        ),
    );
    const provider = new ArrangeProvider(
      new ConfigService({
        AI_BASE_URL: 'https://example.test/v1',
        AI_MODEL: 'test',
        AI_API_KEY: 'secret',
      }),
    );
    await expect(provider.suggest(input)).rejects.toThrow('usable response');
  });
  it('calls a configured compatible provider and extracts JSON', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [{ message: { content: JSON.stringify({ assignments }) } }],
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const provider = new ArrangeProvider(
      new ConfigService({
        AI_BASE_URL: 'http://localhost:1234/v1/',
        AI_MODEL: 'local',
      }),
    );
    await expect(provider.suggest(input)).resolves.toEqual(assignments);
    expect(fetcher.mock.calls[0][0]).toBe(
      'http://localhost:1234/v1/chat/completions',
    );
  });
});
