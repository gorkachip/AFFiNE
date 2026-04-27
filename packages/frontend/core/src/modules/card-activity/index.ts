import { type Framework } from '@toeverything/infra';

import { WorkspaceDBService } from '../db';
import { WorkspaceScope } from '../workspace';
import { CardActivityLogService } from './services/card-activity';

export {
  type CardActivityEntry,
  CardActivityLogService,
} from './services/card-activity';

export function configureCardActivityModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(CardActivityLogService, [WorkspaceDBService]);
}
