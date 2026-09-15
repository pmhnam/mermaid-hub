import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Diagram } from '../diagrams/entities/diagram.entity.js';
import { ResourceRole } from '../permissions/permission.types.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateVersionDto } from './dto/create-version.dto.js';
import { DiagramVersion, VersionType } from './entities/version.entity.js';
import {
  DiagramDocumentState,
  VersionStateProvider,
} from './version-state.provider.js';
import {
  insertDiagramVersion,
  lockDiagramForVersion,
} from './version-persistence.js';

export function applyDocumentState(
  diagram: Diagram,
  state: DiagramDocumentState,
): void {
  diagram.currentContent = state.content;
  diagram.currentConfig = state.config;
  diagram.visualLayout = state.visualLayout;
  diagram.yjsState = null;
}

@Injectable()
export class VersionsService {
  constructor(
    @InjectRepository(DiagramVersion)
    private readonly versions: Repository<DiagramVersion>,
    private readonly dataSource: DataSource,
    private readonly permissions: PermissionsService,
    private readonly stateProvider: VersionStateProvider,
  ) {}

  async findAll(diagramId: string, userId: string) {
    await this.requireDiagram(diagramId, userId, ResourceRole.Viewer);
    return this.versions.find({
      where: { diagramId },
      order: { versionNumber: 'DESC' },
    });
  }

  async findOne(diagramId: string, versionId: string, userId: string) {
    await this.requireDiagram(diagramId, userId, ResourceRole.Viewer);
    const version = await this.versions.findOneBy({
      id: versionId,
      diagramId,
    });
    if (!version) throw new NotFoundException('Diagram version not found');
    return version;
  }

  async createManual(diagramId: string, userId: string, dto: CreateVersionDto) {
    await this.requireDiagram(diagramId, userId, ResourceRole.Editor);
    return this.stateProvider.runExclusive(diagramId, async () => {
      const version = await this.dataSource.transaction(async (manager) => {
        const diagram = await lockDiagramForVersion(manager, diagramId);
        const state = await this.stateProvider.getAuthoritativeState(diagram);
        const created = await insertDiagramVersion(
          manager,
          diagram,
          state,
          VersionType.Manual,
          dto.message?.trim() || null,
          userId,
        );
        diagram.currentVersionId = created.id;
        await manager.save(Diagram, diagram);
        return created;
      });
      this.stateProvider.resetCheckpointState(diagramId);
      return version;
    });
  }

  async restore(diagramId: string, versionId: string, userId: string) {
    await this.requireDiagram(diagramId, userId, ResourceRole.Owner);
    return this.stateProvider.runExclusive(diagramId, async () => {
      const result = await this.dataSource.transaction(async (manager) => {
        const diagram = await lockDiagramForVersion(manager, diagramId);
        const target = await manager
          .getRepository(DiagramVersion)
          .createQueryBuilder('version')
          .setLock('pessimistic_read')
          .where('version.id = :versionId', { versionId })
          .andWhere('version.diagramId = :diagramId', { diagramId })
          .getOne();
        if (!target) throw new NotFoundException('Diagram version not found');

        const beforeRestore =
          await this.stateProvider.getAuthoritativeState(diagram);
        await insertDiagramVersion(
          manager,
          diagram,
          beforeRestore,
          VersionType.Checkpoint,
          `Before restoring version ${target.versionNumber}`,
          userId,
        );

        const restoredState = {
          content: target.content,
          config: target.config,
          visualLayout: target.visualLayout ?? null,
        };
        applyDocumentState(diagram, restoredState);
        const restored = await insertDiagramVersion(
          manager,
          diagram,
          restoredState,
          VersionType.Restore,
          `Restored version ${target.versionNumber}`,
          userId,
        );
        diagram.currentVersionId = restored.id;
        await manager.save(Diagram, diagram);
        return { restored, restoredState };
      });
      await this.stateProvider.replaceActiveState(
        diagramId,
        result.restoredState,
      );
      this.stateProvider.resetCheckpointState(diagramId);
      return result.restored;
    });
  }

  private async requireDiagram(
    diagramId: string,
    userId: string,
    role: ResourceRole,
  ): Promise<void> {
    const exists = await this.dataSource.getRepository(Diagram).existsBy({
      id: diagramId,
    });
    if (!exists) throw new NotFoundException('Diagram not found');
    await this.permissions.requireDiagramRole(userId, diagramId, role);
  }
}
