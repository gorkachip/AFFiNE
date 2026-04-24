import {
  EditorHostKey,
  propertyType,
  t,
} from '@blocksuite/affine/blocks/database';
import {
  UserListProvider,
  UserProvider,
} from '@blocksuite/affine/shared/services';
import zod from 'zod';

export const updatedByColumnType = propertyType('updated-by');
export const updatedByPropertyModelConfig = updatedByColumnType.modelConfig({
  name: 'Last Edited By',
  kanbanGroup: {
    enabled: true,
    mutable: false,
  },
  propertyData: {
    schema: zod.object({}),
    default: () => ({}),
  },
  rawValue: {
    schema: zod.string().nullable(),
    default: () => null,
    toString: ({ value }) => value ?? '',
    fromString: () => ({ value: null }),
    toJson: ({ value }) => value,
    setValue: () => {},
  },
  jsonValue: {
    schema: zod.string().nullable(),
    isEmpty: () => false,
    type: ({ dataSource }) => {
      const host = dataSource.serviceGet(EditorHostKey);
      const userService = host?.std.getOptional(UserProvider);
      const userListService = host?.std.getOptional(UserListProvider);

      return t.user.instance(
        userListService && userService
          ? {
              userService,
              userListService,
            }
          : undefined
      );
    },
  },
});
