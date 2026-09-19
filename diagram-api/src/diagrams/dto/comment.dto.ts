import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateCommentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 4000)
  body: string;
  @IsOptional() @IsString() @MaxLength(200) target?: string;
}
export class ResolveCommentDto {
  @IsBoolean() resolved: boolean;
}
