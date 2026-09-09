import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @Length(1, 120)
  name: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
