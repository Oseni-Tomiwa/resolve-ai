import { Body, Controller, Delete, Get, HttpException, HttpStatus, Optional, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiKeyScopeGuard, JwtOrApiKeyGuard, RequireApiKeyScope } from '../api-keys/api-key-access';
// Nest dependency injection needs this constructor at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AgentsService } from './agents.service';
// Nest validation needs DTO constructors at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AgentListQueryDto, AgentPlaygroundDto, CreateAgentDto, UpdateAgentDto } from './dto';
import { agentModels, defaultAgentModel } from './agent.config';
// Nest dependency injection needs this constructor at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RateLimitService } from '../common/rate-limit.service';

type RequestWithUser = { user: { sub: string }; ip?: string };

@Controller('workspaces/:workspaceId/ai/agents')
export class AgentsController {
  constructor(private readonly service: AgentsService, @Optional() private readonly rateLimit?: RateLimitService) {}
  private async protect(request: RequestWithUser): Promise<void> { if (this.rateLimit) { const key = 'agent-playground:' + (request.user?.sub ?? request.ip ?? 'unknown'); const allowed = this.rateLimit.allowDistributed ? await this.rateLimit.allowDistributed(key, Number(process.env.PUBLIC_RATE_LIMIT_MAX ?? 60), Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS ?? 60000)) : this.rateLimit.allow(key, Number(process.env.PUBLIC_RATE_LIMIT_MAX ?? 60), Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS ?? 60000)); if (!allowed) throw new HttpException({ code: 'RATE_LIMITED', message: 'Please try again shortly.' }, HttpStatus.TOO_MANY_REQUESTS); } }
  @Get('models') @UseGuards(JwtAuthGuard) models() { return { success: true, message: 'Agent models loaded', data: { items: agentModels, defaultModel: defaultAgentModel } }; }
  @Post() @UseGuards(JwtAuthGuard) create(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string, @Body() dto: CreateAgentDto) { return this.service.create(request.user.sub, workspaceId, dto).then((data) => ({ success: true, message: 'Agent created', data })); }
  @Get() @UseGuards(JwtOrApiKeyGuard, ApiKeyScopeGuard) @RequireApiKeyScope('agents:read') list(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string, @Query() query: AgentListQueryDto) { return this.service.list(request.user.sub, workspaceId, query).then((data) => ({ success: true, message: 'Agents loaded', data })); }
  @Get('knowledge-documents') @UseGuards(JwtAuthGuard) documents(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string) { return this.service.selectableDocuments(request.user.sub, workspaceId).then((data) => ({ success: true, message: 'Agent documents loaded', data })); }
  @Get(':agentId') @UseGuards(JwtOrApiKeyGuard, ApiKeyScopeGuard) @RequireApiKeyScope('agents:read') detail(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string, @Param('agentId') agentId: string) { return this.service.detail(request.user.sub, workspaceId, agentId).then((data) => ({ success: true, message: 'Agent loaded', data })); }
  @Patch(':agentId') @UseGuards(JwtAuthGuard) update(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string, @Param('agentId') agentId: string, @Body() dto: UpdateAgentDto) { return this.service.update(request.user.sub, workspaceId, agentId, dto).then((data) => ({ success: true, message: 'Agent updated', data })); }
  @Delete(':agentId') @UseGuards(JwtAuthGuard) remove(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string, @Param('agentId') agentId: string) { return this.service.remove(request.user.sub, workspaceId, agentId).then(() => ({ success: true, message: 'Agent deleted', data: null })); }
  @Post(':agentId/duplicate') @UseGuards(JwtAuthGuard) duplicate(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string, @Param('agentId') agentId: string) { return this.service.duplicate(request.user.sub, workspaceId, agentId).then((data) => ({ success: true, message: 'Agent duplicated', data })); }
  @Post(':agentId/publish') @UseGuards(JwtAuthGuard) publish(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string, @Param('agentId') agentId: string) { return this.service.publish(request.user.sub, workspaceId, agentId).then((data) => ({ success: true, message: 'Agent published', data })); }
  @Post(':agentId/archive') @UseGuards(JwtAuthGuard) archive(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string, @Param('agentId') agentId: string) { return this.service.archive(request.user.sub, workspaceId, agentId).then((data) => ({ success: true, message: 'Agent archived', data })); }
  @Post(':agentId/playground') @UseGuards(JwtAuthGuard) async playground(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string, @Param('agentId') agentId: string, @Body() dto: AgentPlaygroundDto) { await this.protect(request); return this.service.playground(request.user.sub, workspaceId, agentId, dto).then((data) => ({ success: true, message: 'Agent playground response generated', data })); }
  @Post(':agentId/set-default') @UseGuards(JwtAuthGuard) setDefault(@Req() request: RequestWithUser, @Param('workspaceId') workspaceId: string, @Param('agentId') agentId: string) { return this.service.setDefault(request.user.sub, workspaceId, agentId).then((data) => ({ success: true, message: 'Default agent updated', data })); }
}
