import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { CancellationService } from './cancellation.service';

@Global()
@Module({
  providers: [SettingsService, CancellationService],
  exports: [SettingsService, CancellationService],
})
export class CommonModule {}
