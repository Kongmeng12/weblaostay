import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

/**
 * The full new photo order for a property, front to back. The first id
 * becomes the cover — see UploadsService.reorderPhotos.
 */
export class ReorderPhotosDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  photoIds!: string[];
}
