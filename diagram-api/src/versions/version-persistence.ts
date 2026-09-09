import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Diagram } from '../diagrams/entities/diagram.entity.js';
import { DiagramVersion, VersionType } from './entities/version.entity.js';
import { DiagramDocumentState } from './version-state.provider.js';
import { CollaborationActor } from '../collaboration/collaboration-actor.js';

export async function lockDiagramForVersion(
  manager: EntityManager,
  diagramId: string,
): Promise<Diagram> {
  const diagram = await manager
    .getRepository(Diagram)
    .createQueryBuilder('diagram')
    .setLock('pessimistic_write')
    .where('diagram.id = :diagramId', { diagramId })
    .getOne();
  if (!diagram) throw new NotFoundException('Diagram not found');
  return diagram;
}

export async function insertDiagramVersion(
  manager: EntityManager,
  diagram: Diagram,
  state: DiagramDocumentState,
  type: VersionType,
  message: string | null,
  attribution: CollaborationActor | string,
): Promise<DiagramVersion> {
  const actor: CollaborationActor =
    typeof attribution === 'string'
      ? { type: 'registered', userId: attribution }
      : attribution;
  const versionNumber = nextVersionNumber(diagram);
  const version = manager.create(DiagramVersion, {
    diagramId: diagram.id,
    versionNumber,
    content: state.content,
    config: state.config,
    type,
    message,
    createdById: actor.type === 'registered' ? actor.userId : null,
    createdViaPublicLinkId: actor.type === 'public' ? actor.publicLinkId : null,
  });
  return manager.save(DiagramVersion, version);
}

export function nextVersionNumber(diagram: Diagram): number {
  diagram.versionSeq += 1;
  return diagram.versionSeq;
}
