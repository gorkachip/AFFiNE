import { propertyType, t } from '@blocksuite/affine/blocks/database';
import zod from 'zod';

export const deadlineColumnType = propertyType('deadline');

export const deadlinePropertyModelConfig = deadlineColumnType.modelConfig({
  name: 'Deadline',
  propertyData: {
    schema: zod.object({}),
    default: () => ({}),
  },
  rawValue: {
    schema: zod.number().nullable(),
    default: () => null,
    toString: ({ value }) => {
      if (value == null) return '';
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    },
    fromString: ({ value }) => {
      const ts = Date.parse(value);
      return { value: Number.isNaN(ts) ? null : ts };
    },
    toJson: ({ value }) => value,
    fromJson: ({ value }) => value,
  },
  jsonValue: {
    schema: zod.number().nullable(),
    isEmpty: ({ value }) => value == null,
    type: () => t.date.instance(),
  },
});
