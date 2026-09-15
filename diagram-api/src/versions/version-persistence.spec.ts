import { Diagram } from '../diagrams/entities/diagram.entity.js';
import { insertDiagramVersion } from './version-persistence.js';

describe('insertDiagramVersion', () => {
  it('attributes anonymous versions to a public link and no user', async () => {
    const diagram = Object.assign(new Diagram(), {
      id: 'diagram-1',
      versionSeq: 0,
    });
    const manager = {
      create: vi.fn((_entity, values) => values),
      save: vi.fn((_entity, value) => Promise.resolve(value)),
    };

    const version = await insertDiagramVersion(
      manager as never,
      diagram,
      { content: 'graph TD', config: '', visualLayout: null },
      'checkpoint' as never,
      null,
      {
        type: 'public',
        visitorId: 'visitor-1',
        publicLinkId: 'link-1',
        publicLinkNonce: 'nonce-1',
      },
    );

    expect(version).toMatchObject({
      createdById: null,
      createdViaPublicLinkId: 'link-1',
    });
  });
});
