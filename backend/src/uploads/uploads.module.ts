import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UploadsController, AdminProvincePhotoController, AdminUploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { LocalStorageProvider } from './local-storage.provider';
import { R2StorageProvider } from './r2-storage.provider';
import { STORAGE_TOKEN } from './storage.interface';
import { PartnerModule } from '../partner/partner.module';

@Module({
  imports: [ConfigModule, PartnerModule],
  controllers: [UploadsController, AdminProvincePhotoController, AdminUploadsController],
  providers: [
    UploadsService,
    {
      // Constructed here rather than registered as its own @Injectable so
      // that choosing STORAGE_PROVIDER=local never touches R2StorageProvider
      // (and its required S3_* env vars) at all.
      provide: STORAGE_TOKEN,
      useFactory: (config: ConfigService) => {
        const provider = (config.get<string>('STORAGE_PROVIDER', 'local') ?? 'local').toLowerCase();
        return provider === 'r2' ? new R2StorageProvider(config) : new LocalStorageProvider();
      },
      inject: [ConfigService],
    },
  ],
})
export class UploadsModule {}
