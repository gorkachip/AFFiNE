import type { Text } from '@blocksuite/store';
import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
} from '@blocksuite/store';

import type { BlockMeta } from '../../utils/types.js';
import type {
  ColumnDataType,
  SerializedCells,
  ViewBasicDataType,
} from './types.js';

export type DatabaseBlockProps = {
  views: ViewBasicDataType[];
  title: Text;
  cells: SerializedCells;
  columns: Array<ColumnDataType>;
  comments?: Record<string, boolean>;
} & BlockMeta;

export class DatabaseBlockModel extends BlockModel<DatabaseBlockProps> {}

export const DatabaseBlockSchema = defineBlockSchema({
  flavour: 'affine:database',
  props: (internal): DatabaseBlockProps => ({
    views: [],
    title: internal.Text(),
    cells: Object.create(null),
    columns: [],
    comments: undefined,
    'meta:createdAt': undefined,
    'meta:createdBy': undefined,
    'meta:updatedAt': undefined,
    'meta:updatedBy': undefined,
    'meta:trashed': undefined,
    'meta:trashedAt': undefined,
  }),
  metadata: {
    role: 'hub',
    version: 3,
    parent: ['affine:note'],
    children: ['affine:paragraph', 'affine:list'],
  },
  toModel: () => new DatabaseBlockModel(),
});

export const DatabaseBlockSchemaExtension =
  BlockSchemaExtension(DatabaseBlockSchema);
