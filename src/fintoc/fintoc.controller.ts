import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/middleware/jwt.guard';
import { User } from '../auth/decorators/user.decorator';
import { CreateLinkIntentDto } from './dto/create-link-intent.dto';
import { ExchangeTokenDto } from './dto/exchange-token.dto';
import {
  CreateLinkIntentResponseDto,
  ExchangeTokenResponseDto,
  FintocLinkPublicDto,
} from './dto/fintoc-link-response.dto';
import { FintocLinkService } from './services/fintoc-link.service';

interface AuthUser {
  id: string;
}

/**
 * Endpoints JWT-protected para el flujo de link bancario.
 *
 * El controller es deliberadamente thin: sólo mapea Request -> service.
 * Toda la lógica vive en `FintocLinkService`.
 */
@Controller('api/fintoc')
@UseGuards(JwtGuard)
export class FintocController {
  constructor(private readonly linkService: FintocLinkService) {}

  @Post('link-intent')
  @HttpCode(201)
  async createLinkIntent(
    @User() user: AuthUser,
    @Body() _body: CreateLinkIntentDto,
    @Req() req: Request,
  ): Promise<CreateLinkIntentResponseDto> {
    return this.linkService.createIntent(user.id, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('exchange')
  @HttpCode(201)
  async exchange(
    @User() user: AuthUser,
    @Body() dto: ExchangeTokenDto,
    @Req() req: Request,
  ): Promise<ExchangeTokenResponseDto> {
    return this.linkService.exchange(user.id, dto.exchange_token, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get('links')
  async listLinks(@User() user: AuthUser): Promise<FintocLinkPublicDto[]> {
    return this.linkService.listUserLinks(user.id);
  }

  @Delete('links/:id')
  @HttpCode(204)
  async revokeLink(
    @User() user: AuthUser,
    @Param('id') linkId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.linkService.revokeLink(user.id, linkId, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}
