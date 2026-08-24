import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditLogQueryDto } from './audit-log.dto';

describe('AuditLogQueryDto', () => {
  it('accepts the first page from URL query strings', async () => {
    const query = plainToInstance(AuditLogQueryDto, { page: '1', pageSize: '25' });

    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(25);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('rejects page values outside the supported range', async () => {
    const query = plainToInstance(AuditLogQueryDto, { page: '0', pageSize: '101' });

    await expect(validate(query)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'page' }),
      expect.objectContaining({ property: 'pageSize' }),
    ]));
  });
});
