import { ArrayNotEmpty, IsArray, IsEnum, IsString } from 'class-validator';
import { document_type } from '@prisma/client';

/** The multipart text field sent next to a verification document's `file`. */
export class PartnerDocumentDto {
  @IsEnum(document_type, {
    message: `ປະເພດເອກະສານຕ້ອງເປັນ: ${Object.values(document_type).join(' | ')}`,
  })
  type!: document_type;
}

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
