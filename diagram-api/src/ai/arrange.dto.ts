import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ArrangeTableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  id: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  fields: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  service?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  database?: string;
}

export class ArrangeEdgeDto {
  @IsString()
  @MaxLength(256)
  source: string;

  @IsString()
  @MaxLength(256)
  target: string;
}

export class ArrangeDto {
  @IsString()
  @MaxLength(2000)
  instruction: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ArrangeTableDto)
  tables: ArrangeTableDto[];

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ArrangeEdgeDto)
  edges: ArrangeEdgeDto[];
}
