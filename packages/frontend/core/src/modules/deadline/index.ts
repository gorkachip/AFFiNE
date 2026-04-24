import { type Framework } from '@toeverything/infra';

import { WorkspaceDBService } from '../db';
import { WorkspaceScope } from '../workspace';
import { DeadlineIndexService } from './services/deadline-index';

export { DeadlineIndexService } from './services/deadline-index';

export function configureDeadlineModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(DeadlineIndexService, [WorkspaceDBService]);
}
