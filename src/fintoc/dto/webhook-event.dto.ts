import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload del webhook de Fintoc, validado a nivel de estructura.
 * La autenticidad ya fue validada por `FintocWebhookGuard` (HMAC).
 */
export class WebhookEventDto {
  @IsString()
  @MaxLength(120)
  id!: string;

  @IsString()
  @MaxLength(120)
  type!: string;

  @IsIn(['test', 'live'])
  mode!: 'test' | 'live';

  @IsOptional()
  @IsString()
  created_at?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
