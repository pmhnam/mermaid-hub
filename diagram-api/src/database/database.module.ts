import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InitialSchema1757318400000 } from './migrations/1757318400000-InitialSchema.js';
import { PublicDiagramLinks1788940800000 } from './migrations/1788940800000-PublicDiagramLinks.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: false,
        installExtensions: false,
        migrations: [
          InitialSchema1757318400000,
          PublicDiagramLinks1788940800000,
        ],
        migrationsRun: config.get('DB_MIGRATIONS_RUN', 'false') === 'true',
        ssl:
          config.get('DB_SSL', 'false') === 'true'
            ? { rejectUnauthorized: true }
            : false,
      }),
    }),
  ],
})
export class DatabaseModule {}
