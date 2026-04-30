import {
  createORMClient,
  LiveData,
  ObjectPool,
  Service,
  YjsDBAdapter,
} from '@toeverything/infra';
import { Doc as YDoc } from 'yjs';

import type { WorkspaceServerService } from '../../cloud';
import { AuthService } from '../../cloud/services/auth';
import type { WorkspaceService } from '../../workspace';
import { WorkspaceDB, type WorkspaceDBWithTables } from '../entities/db';
import {
  AFFiNE_WORKSPACE_DB_SCHEMA,
  AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA,
  type AFFiNEWorkspaceDbSchema,
  type AFFiNEWorkspaceUserdataDbSchema,
} from '../schema';

const WorkspaceDBClient = createORMClient(AFFiNE_WORKSPACE_DB_SCHEMA);
const WorkspaceUserdataDBClient = createORMClient(
  AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA
);

export class WorkspaceDBService extends Service {
  db: WorkspaceDBWithTables<AFFiNEWorkspaceDbSchema>;
  userdataDBPool = new ObjectPool<
    string,
    WorkspaceDB<AFFiNEWorkspaceUserdataDbSchema>
  >({
    onDangling() {
      return false; // never release
    },
  });

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceServerService: WorkspaceServerService
  ) {
    super();
    this.db = this.framework.createEntity(
      WorkspaceDB<AFFiNEWorkspaceDbSchema>,
      {
        db: new WorkspaceDBClient(
          new YjsDBAdapter(AFFiNE_WORKSPACE_DB_SCHEMA, {
            getDoc: guid => {
              const ydoc = new YDoc({
                // guid format: db${guid}
                guid: `db$${guid}`,
              });
              this.workspaceService.workspace.engine.doc.connectDoc(ydoc);
              this.workspaceService.workspace.engine.doc.addPriority(
                ydoc.guid,
                50
              );
              return ydoc;
            },
          })
        ),
        schema: AFFiNE_WORKSPACE_DB_SCHEMA,
        storageDocId: tableName => `db$${tableName}`,
      }
    ) as WorkspaceDBWithTables<AFFiNEWorkspaceDbSchema>;
  }

  userdataDB(userId: (string & {}) | '__local__') {
    // __local__ for local workspace
    const userdataDb = this.userdataDBPool.get(userId);
    if (userdataDb) {
      return userdataDb.obj as WorkspaceDBWithTables<AFFiNEWorkspaceUserdataDbSchema>;
    }

    const newDB = this.framework.createEntity(
      WorkspaceDB<AFFiNEWorkspaceUserdataDbSchema>,
      {
        db: new WorkspaceUserdataDBClient(
          new YjsDBAdapter(AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA, {
            getDoc: guid => {
              const ydoc = new YDoc({
                // guid format: userdata${userId}${guid}
                guid: `userdata$${userId}$${guid}`,
              });
              this.workspaceService.workspace.engine.doc.connectDoc(ydoc);
              this.workspaceService.workspace.engine.doc.addPriority(
                ydoc.guid,
                50
              );
              return ydoc;
            },
          })
        ),
        schema: AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA,
        storageDocId: tableName => `userdata$${userId}$${tableName}`,
      }
    );

    this.userdataDBPool.put(userId, newDB);
    return newDB as WorkspaceDBWithTables<AFFiNEWorkspaceUserdataDbSchema>;
  }

  authService = this.workspaceServerService.server?.scope.get(AuthService);

  // MOJO: per-tab key used while the auth session is still resolving on a
  // cloud-flavoured workspace. Without this, the original implementation
  // fell back to a workspace-shared `__local__` userdata doc and any
  // favourite/sidebar item one user wrote during that window leaked to
  // every other workspace member. Generating a fresh key per tab makes
  // the pending bucket isolated to this session, so it can never be
  // observed by another user.
  private readonly pendingUserdataKey = `__pending__$${this.workspaceService.workspace.id}$${Math.random().toString(36).slice(2)}`;

  // MOJO: cache the LiveData so consumers always observe (and read .value
  // from) the same instance. Returning a fresh .map() on every access
  // meant the first .value read landed before the upstream had a chance
  // to populate it, which manifested as favourites being written without
  // an owner stamp and disappearing from the writer's own sidebar.
  private _cachedUserdataDB$: LiveData<
    WorkspaceDBWithTables<AFFiNEWorkspaceUserdataDbSchema>
  > | null = null;

  public get userdataDB$(): LiveData<
    WorkspaceDBWithTables<AFFiNEWorkspaceUserdataDbSchema>
  > {
    if (this._cachedUserdataDB$) {
      return this._cachedUserdataDB$;
    }
    // True local-only workspaces (no server) are the only ones that
    // legitimately share __local__ — there's only one user there.
    if (this.workspaceService.workspace.meta.flavour === 'local') {
      this._cachedUserdataDB$ = new LiveData(this.userdataDB('__local__'));
      return this._cachedUserdataDB$;
    }
    // Cloud / selfhost: never fall back to the shared __local__ bucket,
    // even if the auth service hasn't materialised yet. Drop into the
    // per-tab pending bucket while we wait for either authService or an
    // authenticated account, then switch to the user-keyed userdata
    // doc once we have one.
    if (!this.authService) {
      this._cachedUserdataDB$ = new LiveData(
        this.userdataDB(this.pendingUserdataKey)
      );
      return this._cachedUserdataDB$;
    }
    this._cachedUserdataDB$ = this.authService.session.account$.map(account => {
      if (account) {
        return this.userdataDB(account.id);
      }
      return this.userdataDB(this.pendingUserdataKey);
    });
    return this._cachedUserdataDB$;
  }

  static isDBDocId(docId: string) {
    return docId.startsWith('db$') || docId.startsWith('userdata$');
  }
}
