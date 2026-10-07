import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsObject, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';

export class ToolShortcutDto {
  @IsString()
  @Matches(/^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|CapsLock|Space|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter))$/)
  code: string;
  @IsBoolean() ctrl: boolean;
  @IsBoolean() alt: boolean;
  @IsBoolean() shift: boolean;
  @IsBoolean() meta: boolean;
}

export class ToolShortcutsDto {
  @IsOptional() @ValidateNested() @Type(() => ToolShortcutDto) pen?: ToolShortcutDto;
  @IsOptional() @ValidateNested() @Type(() => ToolShortcutDto) eraser?: ToolShortcutDto;
  @IsOptional() @ValidateNested() @Type(() => ToolShortcutDto) rectangle?: ToolShortcutDto;
  @IsOptional() @ValidateNested() @Type(() => ToolShortcutDto) ellipse?: ToolShortcutDto;
  @IsOptional() @ValidateNested() @Type(() => ToolShortcutDto) hand?: ToolShortcutDto;
  @IsOptional() @ValidateNested() @Type(() => ToolShortcutDto) select?: ToolShortcutDto;
}

export class UpdateToolShortcutsDto {
  @IsDefined() @IsObject() @ValidateNested() @Type(() => ToolShortcutsDto)
  shortcuts: ToolShortcutsDto;
}
