import { generationModelIds, generationModels } from '@resolveai/config';

export const agentModels = generationModels;
export const agentModelIds = generationModelIds;
export const defaultAgentModel = agentModels[0]!.id;
export const defaultAgentProvider = agentModels[0]!.provider;
export const defaultAgentTemperature = 0.2;
export const defaultAgentMaxOutputTokens = 800;

export const defaultAgent = {
  name: 'ResolveAI Support Agent',
  slug: 'resolveai-support-agent',
  description: 'Answers questions from the workspace knowledge base.',
  instructions: 'Provide accurate and concise support answers using only the retrieved workspace knowledge. Clearly state when information is unavailable.',
  greeting: 'Hi! How can I help you today?',
  fallbackMessage: 'I couldn’t find enough information in this workspace’s knowledge base to answer that.',
};
