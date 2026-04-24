import { Entity, LiveData } from '@toeverything/infra';
import { map } from 'rxjs';

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
}
