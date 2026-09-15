import {
  IsOptional,
  IsObject,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { DiagramVisualLayout } from '../../versions/version-state.provider.js';

export class UpdateDiagramDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  title?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  folderId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1_000_000)
  currentContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000_000)
  currentConfig?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsObject()
  visualLayout?: DiagramVisualLayout | null;
}
