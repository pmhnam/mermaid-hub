import { Injectable } from '@nestjs/common';
import type { Diagram } from '../diagrams/entities/diagram.entity.js';

export interface DiagramVisualLayout {
  engine: string;
  mode: string;
  offsets: Record<string, { x: number; y: number }>;
}

export interface DiagramDocumentState {
  content: string;
  config: string;
  visualLayout: DiagramVisualLayout | null;
}

@Injectable()
export class VersionStateProvider {
  async getAuthoritativeState(diagram: Diagram): Promise<DiagramDocumentState> {
    return {
      content: diagram.currentContent,
      config: diagram.currentConfig,
      visualLayout: diagram.visualLayout ?? null,
    };
  }

  isRoomActive(_diagramId: string): boolean {
    return false;
  }

  runExclusive<T>(_diagramId: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  async replaceActiveState(
    _diagramId: string,
    _state: DiagramDocumentState,
  ): Promise<void> {}

  resetCheckpointState(_diagramId: string): void {}
}
