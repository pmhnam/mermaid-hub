import { IsEnum } from 'class-validator';
import { PublicLinkMode } from '../entities/public-link.entity.js';

export class UpsertPublicLinkDto {
  @IsEnum(PublicLinkMode)
  mode: PublicLinkMode;
}
