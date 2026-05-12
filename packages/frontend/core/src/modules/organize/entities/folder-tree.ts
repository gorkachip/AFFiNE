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
