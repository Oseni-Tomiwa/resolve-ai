const mockAnthropicCreate = jest.fn();
const mockAnthropicStream = jest.fn();
const mockGoogleGenerate = jest.fn();
const mockGoogleStream = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockAnthropicCreate, stream: mockAnthropicStream } })),
}));

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: mockGoogleGenerate, generateContentStream: mockGoogleStream } })),
}));

import { AnthropicTextGenerationProvider, GoogleTextGenerationProvider } from './index';

const input = { question: 'What is the policy?', instructions: 'Use only the supplied sources.', context: '[Source 1]\nContent:\nRefunds are available within 30 days.', maximumOutputTokens: 100 };

describe('provider adapters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes an Anthropic Messages response', async () => {
    mockAnthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Refunds are available. [1]' }], usage: { input_tokens: 11, output_tokens: 5 } });
    const provider = new AnthropicTextGenerationProvider({ apiKey: 'anthropic-test-only', model: 'claude-sonnet-4-6' });

    const result = await provider.generateGroundedAnswer(input);

    expect(result).toEqual({ answer: 'Refunds are available. [1]', citedSourceNumbers: [1], provider: 'anthropic', model: 'claude-sonnet-4-6', usage: { inputTokens: 11, outputTokens: 5 } });
  });

  it('normalizes Anthropic streaming events', async () => {
    async function* events() {
      yield { type: 'message_start', message: { usage: { input_tokens: 7 } } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello [1]' } };
      yield { type: 'message_delta', usage: { output_tokens: 3 } };
    }
    mockAnthropicStream.mockReturnValue(events());
    const provider = new AnthropicTextGenerationProvider({ apiKey: 'anthropic-test-only', model: 'claude-sonnet-4-6' });

    const result = [];
    for await (const event of provider.streamGroundedAnswer(input)) result.push(event);

    expect(result).toEqual([{ type: 'response.started' }, { type: 'response.delta', delta: 'Hello [1]' }, { type: 'response.completed', usage: { inputTokens: 7, outputTokens: 3 } }]);
  });

  it('normalizes a Gemini response and streaming chunks', async () => {
    mockGoogleGenerate.mockResolvedValue({ text: 'Gemini answer [1]', usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 } });
    async function* chunks() {
      yield { text: 'Gemini ', usageMetadata: { promptTokenCount: 9 } };
      yield { text: 'answer [1]', usageMetadata: { candidatesTokenCount: 4 } };
    }
    mockGoogleStream.mockResolvedValue(chunks());
    const provider = new GoogleTextGenerationProvider({ apiKey: 'google-test-only', model: 'gemini-2.5-flash' });

    const generated = await provider.generateGroundedAnswer(input);
    const streamed = [];
    for await (const event of provider.streamGroundedAnswer(input)) streamed.push(event);

    expect(generated.provider).toBe('google');
    expect(generated.model).toBe('gemini-2.5-flash');
    expect(generated.usage).toEqual({ inputTokens: 9, outputTokens: 4 });
    expect(streamed).toEqual([{ type: 'response.started' }, { type: 'response.delta', delta: 'Gemini ' }, { type: 'response.delta', delta: 'answer [1]' }, { type: 'response.completed', usage: { inputTokens: 9, outputTokens: 4 } }]);
  });
});
