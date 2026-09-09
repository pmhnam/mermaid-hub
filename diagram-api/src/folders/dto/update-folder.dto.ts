import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';

export class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  parentId?: string | null;
}
