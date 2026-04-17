import { Module } from '@nestjs/common';
import { FintocController } from './fintoc.controller';
import { FintocWebhookController } from './fintoc-webhook.controller';
import { FintocApiClient } from './services/fintoc-api.client';
import { FintocCryptoService } from './services/fintoc-crypto.service';
import { FintocLinkService } from './services/fintoc-link.service';
import { FintocSyncService } from './services/fintoc-sync.service';
import { FintocWebhookService } from './services/fintoc-webhook.service';
import { FintocAuditService } from './services/fintoc-audit.service';
import { FintocWebhookGuard } from './guards/fintoc-webhook.guard';

/**
 * Módulo Fintoc — integración de cuentas bancarias chilenas via Fintoc.
 *
 * Seguridad: link_token en Supabase Vault (AES-256-GCM).
 * Auditoría: todo acceso/mutación queda en `fintoc_access_log`.
 * Idempotencia: webhook dedup vía Redis SETNX.
 */
@Module({
  controllers: [FintocController, FintocWebhookController],
  providers: [
    FintocApiClient,
    FintocCryptoService,
    FintocLinkService,
    FintocSyncService,
    FintocWebhookService,
    FintocAuditService,
    FintocWebhookGuard,
  ],
  exports: [FintocLinkService, FintocSyncService],
})
export class FintocModule {}
