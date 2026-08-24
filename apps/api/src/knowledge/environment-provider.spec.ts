import { ServiceUnavailableException } from '@nestjs/common';
import { EnvironmentEmbeddingProvider } from './semantic-search.service';
import { EnvironmentTextGenerationProvider } from './grounded-answer.service';

const generation = { OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, GOOGLE_AI_API_KEY: undefined, OPENAI_GENERATION_MODEL: 'gpt-4o-mini', AI_MAX_OUTPUT_TOKENS: 800, AI_RETRIEVAL_LIMIT: 5, AI_MINIMUM_SCORE: 0.65 };
const embedding = { OPENAI_API_KEY: undefined, OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small', EMBEDDING_BATCH_SIZE: 50 };

describe('production AI environment providers', () => {
  it('fails generation in a controlled way when no key is configured', async () => {
    // Arrange
    const provider = new EnvironmentTextGenerationProvider(generation);
    // Act / Assert
    await expect(provider.generateGroundedAnswer({ question: 'Question', instructions: 'Grounded', context: '[Source 1]', maximumOutputTokens: 100 })).rejects.toThrow(ServiceUnavailableException);
    await expect(provider.generateGroundedAnswer({ question: 'Question', instructions: 'Grounded', context: '[Source 1]', maximumOutputTokens: 100 })).rejects.not.toThrow('sk-');
  });

  it('uses the configured generation and embedding model names', () => {
    // Arrange / Act
    const configuredGeneration = new EnvironmentTextGenerationProvider({ ...generation, OPENAI_API_KEY: 'sk-test-only' });
    const configuredEmbedding = new EnvironmentEmbeddingProvider({ ...embedding, OPENAI_API_KEY: 'sk-test-only' });
    // Assert
    expect(configuredGeneration.model).toBe('gpt-4o-mini');
    expect(configuredEmbedding.model).toBe('text-embedding-3-small');
  });

  it('rejects a configured provider without its server-side credential', async () => {
    const provider = new EnvironmentTextGenerationProvider({ ...generation, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined });
    await expect(provider.generateGroundedAnswer({ provider: 'anthropic', model: 'claude-sonnet-4-6', question: 'Question', instructions: 'Grounded', context: '[Source 1]', maximumOutputTokens: 100 })).rejects.toThrow('Anthropic generation is not configured');
  });

  it('rejects unsupported provider/model combinations before making a request', async () => {
    const provider = new EnvironmentTextGenerationProvider({ ...generation, OPENAI_API_KEY: 'sk-test-only' });
    await expect(provider.generateGroundedAnswer({ provider: 'anthropic', model: 'gpt-4o-mini', question: 'Question', instructions: 'Grounded', context: '[Source 1]', maximumOutputTokens: 100 })).rejects.toThrow('disabled or unsupported');
  });

  it('fails embeddings in a controlled way when no key is configured', async () => {
    // Arrange
    const provider = new EnvironmentEmbeddingProvider(embedding);
    // Act / Assert
    await expect(provider.embed(['text'])).rejects.toThrow('Semantic search embeddings are not configured');
  });
});
