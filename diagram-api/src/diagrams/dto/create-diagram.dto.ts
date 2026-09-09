import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateDiagramDto {
  @IsString()
  @Length(1, 160)
  title: string;

  @IsOptional()
  @IsUUID()
  folderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000_000)
  currentContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000_000)
  currentConfig?: string;
}
