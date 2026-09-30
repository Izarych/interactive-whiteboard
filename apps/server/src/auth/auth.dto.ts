import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class EmailDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail({}, { message: 'Введите корректную почту' })
  @MaxLength(254, { message: 'Адрес почты слишком длинный' })
  email: string;
}

export class LoginDto extends EmailDto {
  @IsString()
  @MinLength(1, { message: 'Введите пароль' })
  @MaxLength(128, { message: 'Пароль не должен превышать 128 символов' })
  password: string;
}

export class RegisterDto extends EmailDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1, { message: 'Введите имя' })
  @MaxLength(80, { message: 'Имя не должно превышать 80 символов' })
  name: string;

  @IsString()
  @MinLength(8, { message: 'Пароль должен содержать не менее 8 символов' })
  @MaxLength(128, { message: 'Пароль не должен превышать 128 символов' })
  password: string;

  @IsOptional()
  @IsUUID('4')
  avatarAssetId?: string;
}

export class ChallengeDto {
  @IsUUID('4')
  challengeId: string;
}

export class VerifyEmailDto extends ChallengeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Введите код из 6 цифр' })
  code: string;
}

export class ResetPasswordDto extends VerifyEmailDto {
  @IsString()
  @MinLength(8, { message: 'Пароль должен содержать не менее 8 символов' })
  @MaxLength(128, { message: 'Пароль не должен превышать 128 символов' })
  password: string;
}

export class UpdateProfileDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1, { message: 'Введите имя' })
  @MaxLength(80, { message: 'Имя не должно превышать 80 символов' })
  name: string;

  @IsOptional()
  @IsUUID('4')
  avatarAssetId?: string | null;
}
