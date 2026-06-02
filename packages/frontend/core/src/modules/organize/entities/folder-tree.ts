import { Entity, LiveData } from '@toeverything/infra';
import { combineLatest, map } from 'rxjs';

import { parseLock } from '../services/folder-lock';
import type { FolderStore } from '../stores/folder';
import { FolderNode } from './folder-node';

export class FolderTree extends Entity {
  constructor(private readonly folderStore: FolderStore) {
    super();
  }

  readonly rootFolder = this.framework.createEntity(FolderNode, {
    id: null,
  });

  isLoading$ = this.folderStore.watchIsLoading();

  // get folder by id
  folderNode$(id: string) {
    return LiveData.from(
      this.folderStore.watchNodeInfo(id).pipe(
        map(info => {
          if (!info) {
            return null;
          }
          return this.framework.createEntity(FolderNode, {
            id,
          });
        })
      ),
      null
    );
  }

  // MOJO: every soft-deleted folder, materialised as FolderNode entities
  // so the Trash page can show their names + restore/delete actions.
  trashedFolders$ = LiveData.from<FolderNode[]>(
    this.folderStore
      .watchTrashedFolders()
      .pipe(
        map(rows =>
          rows.map(row =>
            this.framework.createEntity(FolderNode, { id: row.id })
          )
        )
      ),
    []
  );

  // MOJO: stream the lock state for a given folder id. Returns the parsed
  // FolderLock of the folder itself or of its nearest locked ancestor,
  // or null if neither is locked. Recomputes any time any folder in the
  // tree is locked / unlocked so descendants see the change instantly.
  lockForFolder$(folderId: string) {
    return LiveData.from(
      this.folderStore.watchAllFolders().pipe(
        map(() => {
          // findLockedAncestor walks from the node itself up, so it
          // returns the folder's own lock if set, or the nearest
          // locked ancestor — exactly what the UI needs.
          const found = this.folderStore.findLockedAncestor(folderId);
          return found ? parseLock(found.lock) : null;
        })
      ),
      null
    );
  }

  // MOJO: stream the EFFECTIVE visibility for a folder — resolves any
  // 'inherit' modes by walking up the tree to the nearest concrete
  // public/restricted ancestor. Recomputes whenever any folder in the
  // tree changes, so re-sharing a parent instantly cascades to children
  // that inherit from it.
  effectiveVisibilityForFolder$(folderId: string) {
    return LiveData.from(
      this.folderStore
        .watchAllFolders()
        .pipe(
          map(() => this.folderStore.resolveEffectiveVisibility(folderId))
        ),
      { mode: 'public' as const, users: [] as string[] }
    );
  }

  // MOJO: synchronous resolver — same walk as the LiveData variant but
  // returns immediately. Used inside render-time helpers (e.g. the
  // passthrough check that walks the descendant tree) where subscribing
  // to per-node LiveDatas would create N subscriptions per render.
  resolveEffectiveVisibility(folderId: string) {
    return this.folderStore.resolveEffectiveVisibility(folderId);
  }

  // MOJO: stream the lock state for a given doc id. Returns the parsed
  // FolderLock from the nearest locked ancestor folder, or null if no
  // ancestor is locked. A doc may be linked into more than one folder —
  // the FIRST locked ancestor wins (rare to have one locked + one not).
  lockForDoc$(docId: string) {
    return LiveData.from(
      combineLatest([
        this.folderStore.watchLinksForDoc(docId),
        // Subscribing to the full folders stream forces this LiveData to
        // recompute when any folder is locked / unlocked anywhere in the
        // tree, not just when the doc-link rows change.
        this.folderStore.watchAllFolders(),
      ]).pipe(
        map(([links]) => {
          for (const link of links) {
            const found = this.folderStore.findLockedAncestor(link.id);
            if (found) {
              return parseLock(found.lock);
            }
          }
          return null;
        })
      ),
      null
    );
  }
}
