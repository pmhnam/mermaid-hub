import { IsEnum } from 'class-validator';
import { ResourceRole } from '../../permissions/permission.types.js';

export class UpdateMemberDto {
  @IsEnum(ResourceRole)
  role: ResourceRole;
}
