import { plainToInstance, Type } from 'class-transformer';
import {
  IsBooleanString,
  IsInt,
  Max,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsUrl({ require_tld: false, protocols: ['postgres', 'postgresql'] })
  DATABASE_URL: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(32)
  PUBLIC_LINK_SECRET: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  PORT = 3000;

  @IsOptional()
  @IsString()
  JWT_ACCESS_TTL = '15m';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_DAYS = 30;

  @IsOptional()
  @IsBooleanString()
  COOKIE_SECURE = 'false';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(60)
  COLLABORATION_TICKET_TTL_SECONDS = 45;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(5000)
  COLLABORATION_SAVE_DEBOUNCE_MS = 3000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  COLLABORATION_CHECKPOINT_INTERVAL_MS = 1200000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  COLLABORATION_IDLE_TIMEOUT_MS = 60000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1024)
  COLLABORATION_MAX_MESSAGE_BYTES = 1048576;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(parsed, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return { ...config, ...parsed };
}
