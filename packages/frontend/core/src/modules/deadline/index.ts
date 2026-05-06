import { type Framework } from '@toeverything/infra';

import { WorkspaceDBService } from '../db';
import { DocsService } from '../doc';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { DeadlineIndexService } from './services/deadline-index';
import { DeadlineUiStateService } from './services/deadline-ui-state';

export { DeadlineIndexService } from './services/deadline-index';
export { DeadlineUiStateService } from './services/deadline-ui-state';

export function configureDeadlineModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(DeadlineIndexService, [WorkspaceDBService, WorkspaceService])
    .service(DeadlineUiStateService, [
      WorkspaceDBService,
      WorkspaceService,
      DocsService,
    ]);
}
