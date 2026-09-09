import { Transform } from 'class-transformer';
import { IsEmail, IsEnum } from 'class-validator';
import { ResourceRole } from '../../permissions/permission.types.js';

export class AddMemberDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @IsEnum(ResourceRole)
  role: ResourceRole;
}
