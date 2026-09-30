import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CreateBoardDto } from '../boards.dto';
import { RegisterDto, UpdateProfileDto } from '../auth/auth.dto';

export class AdminQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 20;
  @IsOptional() @IsString() @MaxLength(120)
  search = '';
  @IsOptional() @IsIn(['all', 'active', 'blocked'])
  status = 'all';
}
export class OverviewQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([7, 30, 90])
  days = 30;
}
export class BlockDto { @IsBoolean() blocked: boolean; }
export class AdminNameDto extends CreateBoardDto {}
export class AdminCreateUserDto extends RegisterDto {}
export class AdminUpdateUserDto extends UpdateProfileDto {}
export class AdminPasswordDto { @IsString() @MinLength(8) @MaxLength(128) password: string; }
export class AdminRoleDto {
  @IsIn(['user', 'admin']) role: 'user' | 'admin';
  @IsString() @MinLength(1) @MaxLength(128) password: string;
}
export class TransferGuestDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() email: string;
}
