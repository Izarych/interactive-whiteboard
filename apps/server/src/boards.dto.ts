import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsHexColor, IsIn,
  IsDefined, IsInt, IsNumber, IsObject, IsString, IsUUID, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested, Validate, ValidatorConstraint, ValidatorConstraintInterface,
} from 'class-validator';
import type { BoardBackground, DrawnElement, DrawingElement } from '@whiteboard/shared';

@ValidatorConstraint({ name: 'drawingCoordinates', async: false })
class DrawingCoordinates implements ValidatorConstraintInterface {
  validate(points: unknown, args?: { object: object }) {
    if (!args) return false;
    const element = args.object as DrawnElement;
    return Array.isArray(points) && points.length % 2 === 0 &&
      (element.kind === 'stroke' || points.length === 4);
  }

  defaultMessage() {
    return 'points must contain coordinate pairs; shapes require exactly two pairs';
  }
}

class BaseElementDto {
  @IsUUID('4')
  id: string;

  @IsIn(['stroke', 'rectangle', 'ellipse', 'image'])
  kind: DrawingElement['kind'];
}

class DrawnElementDto extends BaseElementDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  groupId?: string;

  @IsIn(['stroke', 'rectangle', 'ellipse'])
  declare kind: DrawnElement['kind'];

  @IsHexColor()
  color: string;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(1)
  @Max(64)
  width: number;

  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(40000)
  @IsNumber({ allowInfinity: false, allowNaN: false }, { each: true })
  @Min(-1000000, { each: true })
  @Max(1000000, { each: true })
  @Validate(DrawingCoordinates)
  points: number[];
}

class ImageElementDto extends BaseElementDto {
  @Equals('image')
  declare kind: 'image';

  @IsUUID('4')
  assetId: string;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-1000000)
  @Max(1000000)
  x: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-1000000)
  @Max(1000000)
  y: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(1)
  @Max(10000)
  width: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(1)
  @Max(10000)
  height: number;
}

class BoardBackgroundDto {
  @IsIn(['plain', 'dots', 'grid'])
  pattern: BoardBackground['pattern'];

  @IsInt()
  @Min(12)
  @Max(96)
  size: BoardBackground['size'];
}

class BoardDocumentDto {
  @Equals(1)
  version: 1;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => BoardBackgroundDto)
  background?: BoardBackgroundDto;

  @IsArray()
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => BaseElementDto, {
    discriminator: {
      property: 'kind',
      subTypes: [
        { name: 'stroke', value: DrawnElementDto },
        { name: 'rectangle', value: DrawnElementDto },
        { name: 'ellipse', value: DrawnElementDto },
        { name: 'image', value: ImageElementDto },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  elements: (DrawnElementDto | ImageElementDto)[];
}

export class CreateBoardDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;
}

export class UpdateBoardDto extends CreateBoardDto {
  @IsInt()
  @Min(0)
  revision: number;

  @ValidateNested()
  @Type(() => BoardDocumentDto)
  @IsDefined()
  @IsObject()
  document: BoardDocumentDto;
}
