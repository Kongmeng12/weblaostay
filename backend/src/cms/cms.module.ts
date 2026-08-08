import { Module } from '@nestjs/common';
import { CmsService } from './cms.service';
import { AdminCmsController, PublicCmsController } from './cms.controller';

/** Banners, announcements, FAQs and the static pages. */
@Module({
  controllers: [PublicCmsController, AdminCmsController],
  providers: [CmsService],
  exports: [CmsService],
})
export class CmsModule {}
