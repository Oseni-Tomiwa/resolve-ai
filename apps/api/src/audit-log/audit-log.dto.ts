import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
export class AuditLogQueryDto { @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page = 1; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25; @IsOptional() @IsString() action?: string; @IsOptional() @IsString() actorUserId?: string; @IsOptional() @IsString() targetType?: string; @IsOptional() @IsDateString() from?: string; @IsOptional() @IsDateString() to?: string; }
