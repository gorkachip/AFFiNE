import type { PropertyMetaConfig } from '@blocksuite/affine/blocks/database';

import { activityLogPropertyConfig } from './activity-log/view';
import { createdByPropertyConfig } from './created-by/view';
import { filePropertyConfig } from './file/view';
import { memberPropertyConfig } from './member/view';
import { updatedByPropertyConfig } from './updated-by/view';

export const propertiesPresets: PropertyMetaConfig<string, any, any, any>[] = [
  filePropertyConfig,
  memberPropertyConfig,
  createdByPropertyConfig,
  updatedByPropertyConfig,
  activityLogPropertyConfig,
];
