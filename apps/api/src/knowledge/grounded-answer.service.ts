import { getGenerationModel, type GenerationEnv } from '@resolveai/config';
import { AnthropicTextGenerationProvider, GoogleTextGenerationProvider, OpenAITextGenerationProvider, type GroundedAnswerInput, type GroundedAnswerOutput, type GenerationEvent, type TextGenerationProvider } from '@resolveai/ai';
import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
// Nest dependency injection needs this constructor at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SemanticSearchService } from './semantic-search.service';
import type { GroundedAnswerDto } from './grounded-answer.dto';
import { buildGroundedContext, composeAgentInstructions } from './grounded-prompt';
// Nest dependency injection needs this service constructor at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BillingUsageService } from '../billing/billing-usage.service';

export const GROUNDED_TEXT_PROVIDER = 'GROUNDED_TEXT_PROVIDER';
export const GENERATION_CONFIG = 'GENERATION_CONFIG';
const insufficientAnswer = 'I couldn’t find enough information in this workspace’s knowledge base to answer that.';
const contextCharacterLimit = 12000;
export type GroundedSource = { id: string; number: number; documentId: string; documentName: string; chunkIndex: number; contentPreview: string; similarityScore: number; cited: boolean; chunkId: string };
export type PreparedGroundedAnswer = { question: string; selected: Awaited<ReturnType<SemanticSearchService['search']>>['results']; sources: GroundedSource[]; context: string; instructions: string; maximumOutputTokens: number; provider: string; model: string; temperature: number; topP: number; requireCitations: boolean; insufficient: boolean };
export type AgentGenerationOptions = { instructions?: string; fallbackMessage?: string | null; provider?: string; model?: string; temperature?: number; topP?: number; maxOutputTokens?: number; documentIds?: string[]; requireCitations?: boolean; groundedOnly?: boolean; allowGeneralKnowledge?: boolean };
@Injectable()
export class EnvironmentTextGenerationProvider implements TextGenerationProvider {
  readonly provider = 'openai';
  constructor(@Inject(GENERATION_CONFIG) private readonly config: GenerationEnv) {}
  get model(): string { return this.config.OPENAI_GENERATION_MODEL; }
  private resolve(provider: string, model: string): TextGenerationProvider {
    if (!getGenerationModel(provider, model)) throw new BadRequestException('The selected AI model is disabled or unsupported');
    if (provider === 'openai') {
      if (!this.config.OPENAI_API_KEY) throw new ServiceUnavailableException('OpenAI generation is not configured');
      return new OpenAITextGenerationProvider({ apiKey: this.config.OPENAI_API_KEY, model });
    }
    if (provider === 'anthropic') {
      if (!this.config.ANTHROPIC_API_KEY) throw new ServiceUnavailableException('Anthropic generation is not configured');
      return new AnthropicTextGenerationProvider({ apiKey: this.config.ANTHROPIC_API_KEY, model });
    }
    if (!this.config.GOOGLE_AI_API_KEY) throw new ServiceUnavailableException('Google AI generation is not configured');
    return new GoogleTextGenerationProvider({ apiKey: this.config.GOOGLE_AI_API_KEY, model });
  }
  async generateGroundedAnswer(input: Parameters<TextGenerationProvider['generateGroundedAnswer']>[0]): Promise<GroundedAnswerOutput> {
    return this.resolve(input.provider ?? 'openai', input.model ?? this.config.OPENAI_GENERATION_MODEL).generateGroundedAnswer(input);
  }
  streamGroundedAnswer(input: Parameters<TextGenerationProvider['generateGroundedAnswer']>[0], signal?: AbortSignal): AsyncIterable<GenerationEvent> {
    const provider = this.resolve(input.provider ?? 'openai', input.model ?? this.config.OPENAI_GENERATION_MODEL);
    if (!provider.streamGroundedAnswer) throw new ServiceUnavailableException('Streaming answer generation is not configured');
    return provider.streamGroundedAnswer(input, signal);
  }
}

const preview = (content: string): string => content.replace(/\s+/g, ' ').trim().slice(0, 240);
const normalizeForDeduplication = (content: string): string => content.replace(/\s+/g, ' ').trim().toLowerCase();
const heavilyOverlaps = (left: string, right: string): boolean => { const shorter = left.length <= right.length ? left : right; const longer = left.length <= right.length ? right : left; return shorter.length >= 120 && longer.includes(shorter); };

@Injectable()
export class GroundedAnswerService {
  private readonly lastRequestAt = new Map<string, number>();
  constructor(private readonly semanticSearch: SemanticSearchService, @Inject(GROUNDED_TEXT_PROVIDER) private readonly generationProvider: TextGenerationProvider, @Inject(GENERATION_CONFIG) private readonly config: GenerationEnv, @Optional() private readonly billingUsage?: BillingUsageService) {}

  async answer(userId: string, workspaceId: string, input: GroundedAnswerDto) {
    const startedAt = Date.now();
    await this.billingUsage?.assertCanConsume(workspaceId, 'AI_REQUESTS');
    const prepared = await this.prepare(userId, workspaceId, input.question, input.documentIds);
    if (prepared.insufficient) {
      console.info(JSON.stringify({ event: 'knowledge.answer', requestId: randomUUID(), workspaceId, userId, retrievedSourceCount: 0, model: null, latencyMs: Date.now() - startedAt, success: true, category: 'insufficient_context' }));
      return { answer: insufficientAnswer, sources: [], provider: null, model: null, usage: { inputTokens: 0, outputTokens: 0 } };
    }
    const generated = await this.generate({ question: prepared.question, context: prepared.context, instructions: prepared.instructions, maximumOutputTokens: prepared.maximumOutputTokens, model: prepared.model, temperature: prepared.temperature, topP: prepared.topP });
    if (prepared.requireCitations && generated.citedSourceNumbers.length === 0) return { answer: insufficientAnswer, sources: [], provider: null, model: null, usage: generated.usage };
    const sources = this.sourcesFor(prepared, generated.citedSourceNumbers);
    const requestId = randomUUID();
    console.info(JSON.stringify({ event: 'knowledge.answer', requestId, workspaceId, userId, retrievedSourceCount: prepared.selected.length, model: generated.model, latencyMs: Date.now() - startedAt, inputTokens: generated.usage.inputTokens, outputTokens: generated.usage.outputTokens, success: true, category: 'generated' }));
    return { answer: generated.answer, sources, provider: generated.provider, model: generated.model, usage: generated.usage };
  }

  async prepare(userId: string, workspaceId: string, rawQuestion: string, documentIds?: string[], agent?: AgentGenerationOptions): Promise<PreparedGroundedAnswer> {
    return this.prepareInternal(userId, workspaceId, rawQuestion, documentIds, agent, false);
  }

  async preparePublic(workspaceId: string, rawQuestion: string, agent?: AgentGenerationOptions): Promise<PreparedGroundedAnswer> {
    return this.prepareInternal(undefined, workspaceId, rawQuestion, undefined, agent, true);
  }

  private async prepareInternal(userId: string | undefined, workspaceId: string, rawQuestion: string, documentIds: string[] | undefined, agent: AgentGenerationOptions | undefined, publicAccess: boolean): Promise<PreparedGroundedAnswer> {
    const question = rawQuestion.trim();
    if (!question) throw new BadRequestException('Question cannot be empty');
    if (question.length > 1000) throw new BadRequestException('Question must be 1000 characters or fewer');
    const requestKey = `${userId}:${workspaceId}`;
    const now = Date.now();
    if (now - (this.lastRequestAt.get(requestKey) ?? 0) < 2000) throw new HttpException('Please wait before asking another question', HttpStatus.TOO_MANY_REQUESTS);
    this.lastRequestAt.set(requestKey, now);
    const env = this.config;
    const scopedDocumentIds = agent?.documentIds?.length ? agent.documentIds : documentIds;
    const retrieval = publicAccess ? await this.semanticSearch.searchPublic(workspaceId, { query: question, limit: env.AI_RETRIEVAL_LIMIT, minimumScore: env.AI_MINIMUM_SCORE, documentIds: scopedDocumentIds }) : await this.semanticSearch.search(userId as string, workspaceId, { query: question, limit: env.AI_RETRIEVAL_LIMIT, minimumScore: env.AI_MINIMUM_SCORE, documentIds: scopedDocumentIds });
    const selected = [] as typeof retrieval.results;
    let contextLength = 0;
    for (const result of retrieval.results) { const normalized = normalizeForDeduplication(result.content); if (selected.some((candidate) => normalized === normalizeForDeduplication(candidate.content) || heavilyOverlaps(normalized, normalizeForDeduplication(candidate.content)))) continue; if (contextLength + result.content.length > contextCharacterLimit) break; selected.push(result); contextLength += result.content.length; }
    const provider = agent?.provider ?? 'openai';
    const model = agent?.model ?? env.OPENAI_GENERATION_MODEL;
    if (!getGenerationModel(provider, model)) throw new BadRequestException('The selected AI model is disabled or unsupported');
    const temperature = agent?.temperature ?? 0.2;
    const topP = agent?.topP ?? 1;
    const maximumOutputTokens = agent?.maxOutputTokens ?? env.AI_MAX_OUTPUT_TOKENS;
    const instructions = composeAgentInstructions(agent?.instructions);
    console.info(JSON.stringify({ event: 'knowledge.grounded_context_retrieved', workspaceId, userId: userId ?? null, retrievedResultCount: retrieval.results.length, selectedSourceCount: selected.length, contextCharacterCount: contextLength, minimumScore: env.AI_MINIMUM_SCORE, publicAccess }));
    const requireCitations = agent?.requireCitations ?? true;
    if (selected.length === 0) return { question, selected, sources: [], context: '', instructions, maximumOutputTokens, provider, model, temperature, topP, requireCitations, insufficient: true };
    await this.billingUsage?.assertCanConsume(workspaceId, 'TOKENS', Math.ceil(contextLength / 4) + maximumOutputTokens);
    const promptSources = selected.map((result, index) => ({ number: index + 1, documentName: result.document.name, chunkIndex: result.chunkIndex, content: result.content }));
    console.info(JSON.stringify({ event: 'knowledge.grounded_prompt_constructed', workspaceId, userId: userId ?? null, sourceCount: promptSources.length, contextCharacterCount: contextLength, model, maximumOutputTokens, publicAccess }));
    return { question, selected, sources: [], context: buildGroundedContext(promptSources), instructions, maximumOutputTokens, provider, model, temperature, topP, requireCitations, insufficient: false };
  }

  sourcesFor(prepared: PreparedGroundedAnswer, citedSourceNumbers: readonly number[]): GroundedSource[] {
    const validCitationNumbers = new Set(citedSourceNumbers.filter((number) => number >= 1 && number <= prepared.selected.length));
    return prepared.selected.map((result, index) => ({ id: result.chunkId, number: index + 1, documentId: result.document.id, documentName: result.document.name, chunkIndex: result.chunkIndex, contentPreview: preview(result.content), similarityScore: result.similarityScore, cited: validCitationNumbers.has(index + 1), chunkId: result.chunkId }));
  }

  providerMetadata(): { provider: string; model: string } { return { provider: this.generationProvider.provider, model: this.generationProvider.model }; }

  async completePrepared(input: GroundedAnswerInput): Promise<GroundedAnswerOutput> { return this.generate(input); }

  streamPrepared(input: GroundedAnswerInput, signal?: AbortSignal): AsyncIterable<GenerationEvent> {
    if (!this.generationProvider.streamGroundedAnswer) throw new ServiceUnavailableException('Streaming answer generation is not configured');
    return this.generationProvider.streamGroundedAnswer(input, signal);
  }

  private async generate(input: GroundedAnswerInput): Promise<GroundedAnswerOutput> {
    try { return await this.generationProvider.generateGroundedAnswer(input); } catch (error) { if (error instanceof ServiceUnavailableException) throw error; throw new ServiceUnavailableException('Grounded answer generation is currently unavailable'); }
  }
}
