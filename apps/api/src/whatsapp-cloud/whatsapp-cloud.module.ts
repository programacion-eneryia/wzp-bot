import { Global, Module } from '@nestjs/common';
import { WhatsAppCloudService } from './whatsapp-cloud.service';
import { ConversionsApiService } from './conversions-api.service';

/** Capa oficial de Meta (WhatsApp Cloud API + Conversions API). Global. */
@Global()
@Module({
  providers: [WhatsAppCloudService, ConversionsApiService],
  exports: [WhatsAppCloudService, ConversionsApiService],
})
export class WhatsAppCloudModule {}
