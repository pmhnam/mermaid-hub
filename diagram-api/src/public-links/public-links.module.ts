import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicLink } from './entities/public-link.entity.js';
import { PublicLinksService } from './public-links.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([PublicLink])],
  providers: [PublicLinksService],
  exports: [PublicLinksService, TypeOrmModule],
})
export class PublicLinksModule {}
