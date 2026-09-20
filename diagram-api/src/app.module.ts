import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { UsersModule } from './users/users.module.js';
import { AuthModule } from './auth/auth.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';
import { FoldersModule } from './folders/folders.module.js';
import { DiagramsModule } from './diagrams/diagrams.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { validateEnvironment } from './config/environment.js';
import { VersionsModule } from './versions/versions.module.js';
import { CollaborationModule } from './collaboration/collaboration.module.js';
import { LoggerModule } from 'nestjs-pino';
import { pinoHttpOptions } from './config/logger.js';
import { ArrangeModule } from './ai/arrange.module.js';

@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions }),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    WorkspacesModule,
    FoldersModule,
    DiagramsModule,
    PermissionsModule,
    CollaborationModule,
    VersionsModule,
    ArrangeModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
