import { Body, Controller, HttpException, HttpStatus, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
// Nest dependency injection and validation need these constructors at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GroundedAnswerService } from './grounded-answer.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GroundedAnswerDto } from './grounded-answer.dto';
// Nest dependency injection needs this constructor at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RateLimitService } from '../common/rate-limit.service';

type RequestWithUser = { user: { sub: string }; ip?: string };

@Controller('workspaces/:workspaceId/knowledge')
@UseGuards(JwtAuthGuard)
export class GroundedAnswerController {
  constructor(private readonly service: GroundedAnswerService, @Optional() private readonly rateLimit?: RateLimitService) {}
  private async protect(request: RequestWithUser): Promise<void> { if (this.rateLimit) { const key = 'grounded-answer:' + (request.user?.sub ?? request.ip ?? 'unknown'); const allowed = this.rateLimit.allowDistributed ? await this.rateLimit.allowDistributed(key, Number(process.env.PUBLIC_RATE_LIMIT_MAX ?? 60), Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS ?? 60000)) : this.rateLimit.allow(key, Number(process.env.PUBLIC_RATE_LIMIT_MAX ?? 60), Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS ?? 60000)); if (!allowed) throw new HttpException({ code: 'RATE_LIMITED', message: 'Please try again shortly.' }, HttpStatus.TOO_MANY_REQUESTS); } }
  @Post('answer') async answer(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string, @Body() dto: GroundedAnswerDto) { await this.protect(request); return this.service.answer(request.user.sub, workspaceId, dto).then((data) => ({ success: true, message: 'Grounded answer generated', data })); }
}
