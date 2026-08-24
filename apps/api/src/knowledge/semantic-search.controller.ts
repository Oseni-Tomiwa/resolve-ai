import { Body, Controller, HttpException, HttpStatus, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiKeyScopeGuard, JwtOrApiKeyGuard, RequireApiKeyScope } from '../api-keys/api-key-access';
// Nest dependency injection and validation need these constructors at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SemanticSearchService } from './semantic-search.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SemanticSearchDto } from './semantic-search.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RateLimitService } from '../common/rate-limit.service';

type RequestWithUser = { user: { sub: string }; ip?: string };
@Controller('workspaces/:workspaceId/knowledge')
@UseGuards(JwtOrApiKeyGuard, ApiKeyScopeGuard)
@RequireApiKeyScope('knowledge:read')
export class SemanticSearchController {
  constructor(private readonly service: SemanticSearchService, @Optional() private readonly rateLimit?: RateLimitService) {}
  private async protect(request: RequestWithUser): Promise<void> { if (this.rateLimit) { const key = 'semantic-search:' + (request.user?.sub ?? request.ip ?? 'unknown'); const allowed = this.rateLimit.allowDistributed ? await this.rateLimit.allowDistributed(key, Number(process.env.PUBLIC_RATE_LIMIT_MAX ?? 60), Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS ?? 60000)) : this.rateLimit.allow(key, Number(process.env.PUBLIC_RATE_LIMIT_MAX ?? 60), Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS ?? 60000)); if (!allowed) throw new HttpException({ code: 'RATE_LIMITED', message: 'Please try again shortly.' }, HttpStatus.TOO_MANY_REQUESTS); } }
  @Post('search') async search(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string, @Body() dto: SemanticSearchDto) { await this.protect(request); return this.service.search(request.user.sub, workspaceId, dto).then((data) => ({ success: true, message: 'Knowledge search completed', data })); }
}
