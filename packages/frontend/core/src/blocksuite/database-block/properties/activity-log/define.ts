import { propertyType, t } from '@blocksuite/affine/blocks/database';
import zod from 'zod';

export const activityLogColumnType = propertyType('activity-log');

const ActivityEntrySchema: zod.ZodType<{
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  timestamp: number;
  mentions: string[];
  editedAt?: number;
  replies?: Array<{
    id: string;
    authorId: string;
    authorName: string;
    text: string;
    timestamp: number;
    mentions: string[];
    editedAt?: number;
  }>;
}> = zod.lazy(() =>
  zod.object({
    id: zod.string(),
    authorId: zod.string(),
    authorName: zod.string(),
    text: zod.string(),
    timestamp: zod.number(),
    mentions: zod.array(zod.string()),
    editedAt: zod.number().optional(),
    replies: zod.array(ActivityEntrySchema).optional(),
  })
);

const ActivityLogValueSchema = zod.object({
  entries: zod.array(ActivityEntrySchema),
});

// Stored on each kanban row as a JSON string (last-write-wins). Same payload
// shape as the workspace-level Activity Log property so they could be merged
// or migrated later.
const RawValueSchema = zod.string();

export type ActivityLogCellRawValue = zod.TypeOf<typeof RawValueSchema>;

export const activityLogPropertyModelConfig = activityLogColumnType.modelConfig(
  {
    name: 'MOJO Activity Log',
    propertyData: {
      schema: zod.object({}),
      default: () => ({}),
    },
    rawValue: {
      schema: RawValueSchema,
      default: () => '',
      toString: ({ value }) => {
        if (!value) return '';
        try {
          const parsed = ActivityLogValueSchema.parse(JSON.parse(value));
          return parsed.entries.map(e => e.text).join('\n');
        } catch {
          return '';
        }
      },
      fromString: ({ value }) => ({ value: value }),
      toJson: ({ value }) => value ?? '',
    },
    jsonValue: {
      schema: zod.string(),
      type: () => t.string.instance(),
      isEmpty: ({ value }) => {
        if (!value) return true;
        try {
          const parsed = ActivityLogValueSchema.parse(JSON.parse(value));
          return parsed.entries.length === 0;
        } catch {
          return true;
        }
      },
    },
  }
);
