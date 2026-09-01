import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PlaceResolverService } from './place-resolver.service';

/** Public browsing: search, property detail, availability calendar, master data. */
@Module({
  controllers: [CatalogController],
  providers: [CatalogService, PlaceResolverService],
  exports: [CatalogService],
})
export class CatalogModule {}
