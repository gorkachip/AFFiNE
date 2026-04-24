import type { GfxModel } from '@blocksuite/std/gfx';
import { z } from 'zod';

import type {
  BrushElementModel,
  ConnectorElementModel,
  GroupElementModel,
} from '../elements';

export type EmbedCardStyle =
  | 'horizontal'
  | 'horizontalThin'
  | 'list'
  | 'vertical'
  | 'cube'
  | 'cubeThick'
  | 'video'
  | 'figma'
  | 'html'
  | 'syncedDoc'
  | 'pdf'
  | 'citation'
  | 'audio';

export const LinkPreviewDataSchema = z.object({
  description: z.string().nullable(),
  icon: z.string().nullable(),
  image: z.string().nullable(),
  title: z.string().nullable(),
});

export type LinkPreviewData = z.infer<typeof LinkPreviewDataSchema>;

export type Connectable = Exclude<
  GfxModel,
  ConnectorElementModel | BrushElementModel | GroupElementModel
>;

export type BlockMeta = {
  'meta:createdAt'?: number;
  'meta:createdBy'?: string;
  'meta:updatedAt'?: number;
  'meta:updatedBy'?: string;
  /** MOJO: soft-delete flag for database rows (cards). Hidden from views,
   *  visible to admins via the per-kanban Trash. */
  'meta:trashed'?: boolean;
  'meta:trashedAt'?: number;
};
