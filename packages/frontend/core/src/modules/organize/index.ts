import { type Framework } from '@toeverything/infra';

import { WorkspaceDBService } from '../db';
import { WorkspaceScope } from '../workspace';
import { FolderNode } from './entities/folder-node';
import { FolderTree } from './entities/folder-tree';
import { FolderLockService } from './services/folder-lock';
import { FolderVisibilityService } from './services/folder-visibility';
import { OrganizeService } from './services/organize';
import { FolderStore } from './stores/folder';

export type { FolderNode } from './entities/folder-node';
export {
  canUserToggleLock,
  type FolderLock,
  FolderLockService,
  isFolderLocked,
  parseLock,
  serializeLock,
} from './services/folder-lock';
export {
  canUserSeeFolder,
  type FolderVisibility,
  FolderVisibilityService,
  parseVisibility,
  serializeVisibility,
} from './services/folder-visibility';
export { OrganizeService } from './services/organize';

export function configureOrganizeModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(OrganizeService)
    .service(FolderVisibilityService)
    .service(FolderLockService)
    .entity(FolderTree, [FolderStore])
    .entity(FolderNode, [FolderStore])
    .store(FolderStore, [WorkspaceDBService]);
}
