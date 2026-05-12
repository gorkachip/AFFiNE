import { DocRole } from '@affine/graphql';
import { LiveData, Service } from '@toeverything/infra';

import type { WorkspaceService } from '../../workspace';
import type { DocGrantedUsersStore } from '../stores/doc-granted-users';
import type { GrantedUser } from './doc-granted-users';

/**
 * MOJO: workspace-scoped cache of explicit per-user grants for arbitrary
 * docs. The built-in `DocGrantedUsersService` is doc-scoped (only usable
 * from inside the editor for the currently open doc) which doesn't fit
 * the lock checker — that has to answer "is this doc locked for this
 * user?" for any docId from sidebar/bridge contexts.
 *
 * The cache is filled lazily: the first lookup for a doc kicks off
 * pagination, subsequent ones read the cached LiveData synchronously.
 */
interface CacheEntry {
  grants$: LiveData<GrantedUser[]>;
  hasMore$: LiveData<boolean>;
  isLoading$: LiveData<boolean>;
  loaded$: LiveData<boolean>;
  cursor: string | undefined;
  inFlight: Promise<void> | null;
}

const PAGE_SIZE = 50;

export class MojoDocGrantsCacheService extends Service {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly store: DocGrantedUsersStore,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  getOrCreate(docId: string): CacheEntry {
    let entry = this.cache.get(docId);
    if (!entry) {
      entry = {
        grants$: new LiveData<GrantedUser[]>([]),
        hasMore$: new LiveData(true),
        isLoading$: new LiveData(false),
        loaded$: new LiveData(false),
        cursor: undefined,
        inFlight: null,
      };
      this.cache.set(docId, entry);
    }
    return entry;
  }

  /**
   * Load every page for `docId`. Subsequent calls while a load is in
   * flight return the same promise. Once all pages are loaded `loaded$`
   * flips to true so callers can watch for completion.
   */
  loadAll(docId: string): Promise<void> {
    const entry = this.getOrCreate(docId);
    if (entry.inFlight) return entry.inFlight;
    if (!entry.hasMore$.value) {
      entry.loaded$.next(true);
      return Promise.resolve();
    }
    entry.inFlight = (async () => {
      try {
        while (entry.hasMore$.value) {
          entry.isLoading$.next(true);
          const res = await this.store.fetchDocGrantedUsersList(
            this.workspaceService.workspace.id,
            docId,
            { first: PAGE_SIZE, after: entry.cursor }
          );
          entry.grants$.next([
            ...entry.grants$.value,
            ...res.edges.map(e => e.node),
          ]);
          entry.cursor = res.pageInfo.endCursor ?? undefined;
          entry.hasMore$.next(res.pageInfo.hasNextPage);
          entry.isLoading$.next(false);
        }
        entry.loaded$.next(true);
      } catch (err) {
        console.error('[mojo doc grants cache] load failed', err);
      } finally {
        entry.isLoading$.next(false);
        entry.inFlight = null;
      }
    })();
    return entry.inFlight;
  }

  /**
   * Synchronous lookup. Returns the user's explicit role from the
   * cached grants, or null if no entry was cached or the user wasn't
   * granted access. Does NOT trigger a load — pair with `loadAll` if
   * you need fresh data.
   */
  getExplicitRoleSync(docId: string, userId: string): DocRole | null {
    const entry = this.cache.get(docId);
    if (!entry || !entry.loaded$.value) return null;
    const grant = entry.grants$.value.find(g => g.user.id === userId);
    return grant?.role ?? null;
  }

  /**
   * Reactive variant of `getExplicitRoleSync`. Useful for the editor
   * bypass computation that re-renders when the grants list changes.
   */
  explicitRoleFor$(docId: string, userId: string | null) {
    const entry = this.getOrCreate(docId);
    return LiveData.computed(get => {
      const loaded = get(entry.loaded$);
      const grants = get(entry.grants$);
      if (!loaded || !userId) return null;
      const grant = grants.find(g => g.user.id === userId);
      return grant?.role ?? null;
    });
  }

  /**
   * Drop the cache for a doc. Callers should invalidate after a role
   * change so the next lookup re-fetches.
   */
  invalidate(docId: string) {
    this.cache.delete(docId);
  }
}

/**
 * Helper: roles that bypass the folder lock.
 *
 * Owner / Manager / Editor are the explicit "this person can mutate
 * this doc" grants. Reader / Commenter still see the lock.
 */
export function roleBypassesLock(role: DocRole | null): boolean {
  if (!role) return false;
  return (
    role === DocRole.Owner ||
    role === DocRole.Manager ||
    role === DocRole.Editor
  );
}
