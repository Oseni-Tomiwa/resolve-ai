import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAgentDto } from './dto';

describe('Agent request DTO contracts', () => {
  it('accepts bounded configuration and transforms numeric controls', async () => {
    // Arrange
    const dto = plainToInstance(CreateAgentDto, { name: 'Support', instructions: 'Use knowledge.', temperature: '0.4', maxOutputTokens: '600', model: 'gpt-4o-mini' });
    // Act
    const errors = await validate(dto);
    // Assert
    expect(errors).toHaveLength(0);
    expect(dto.temperature).toBe(0.4);
    expect(dto.maxOutputTokens).toBe(600);
  });

  it('accepts an enabled provider and matching model pair', async () => {
    // Arrange
    const dto = plainToInstance(CreateAgentDto, { name: 'Claude Support', instructions: 'Use knowledge.', provider: 'anthropic', model: 'claude-sonnet-4-6' });
    // Act
    const errors = await validate(dto);
    // Assert
    expect(errors).toHaveLength(0);
  });

  it('rejects an unapproved model and unsafe token limits', async () => {
    // Arrange
    const dto = plainToInstance(CreateAgentDto, { name: 'Support', instructions: 'Use knowledge.', model: 'unapproved-model', maxOutputTokens: 20 });
    // Act
    const errors = await validate(dto);
    // Assert
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['model', 'maxOutputTokens']));
  });
});
