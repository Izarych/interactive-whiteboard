import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class UpdateSiteFileDto {
  @IsString() @MaxLength(1048576)
  content: string;

  @ValidateIf((_object, value) => value !== null)
  @IsString() @Matches(/^[a-f0-9]{64}$/)
  revision: string | null;
}
