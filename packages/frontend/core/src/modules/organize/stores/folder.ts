import { Store } from '@toeverything/infra';

import type { WorkspaceDBService } from '../../db';

export class FolderStore extends Store {
  constructor(private readonly dbService: WorkspaceDBService) {
    super();
  }

  watchNodeInfo(nodeId: string) {
    return this.dbService.db.folders.get$(nodeId);
  }

  watchNodeChildren(parentId: string | null) {
    return this.dbService.db.folders.find$({
      parentId: parentId,
    });
  }

  // MOJO: stream every folder row currently flagged trashed=true. Used
  // by the Trash page to show soft-deleted folders alongside docs.
  watchTrashedFolders() {
    return this.dbService.db.folders.find$({
      type: 'folder',
      trashed: true,
    });
  }

  watchIsLoading() {
    return this.dbService.db.folders.isLoading$;
  }

  isAncestor(childId: string, ancestorId: string): boolean {
    if (childId === ancestorId) {
      return false;
    }
    const history = new Set<string>([childId]);
    let current: string = childId;
    while (current) {
      const info = this.dbService.db.folders.get(current);
      if (info === null || !info.parentId) {
        return false;
      }
      current = info.parentId;
      if (history.has(current)) {
        return false; // loop detected
      }
      history.add(current);
      if (current === ancestorId) {
        return true;
      }
    }
    return false;
  }

  createLink(
    parentId: string,
    type: 'doc' | 'tag' | 'collection',
    nodeId: string,
    index: string
  ) {
    const parent = this.dbService.db.folders.get(parentId);
    if (parent === null || parent.type !== 'folder') {
      throw new Error('Parent folder not found');
    }

    this.dbService.db.folders.create({
      parentId,
      type,
      data: nodeId,
      index: index,
    });
  }

  renameNode(nodeId: string, name: string) {
    const node = this.dbService.db.folders.get(nodeId);
    if (node === null) {
      throw new Error('Node not found');
    }
    if (node.type !== 'folder') {
      throw new Error('Cannot rename non-folder node');
    }
    this.dbService.db.folders.update(nodeId, {
      data: name,
    });
  }

  createFolder(
    parentId: string | null,
    name: string,
    index: string,
    createdBy?: string
  ) {
    if (parentId) {
      const parent = this.dbService.db.folders.get(parentId);
      if (parent === null || parent.type !== 'folder') {
        throw new Error('Parent folder not found');
      }
    }

    // MOJO: every new folder is private by default — only the creator
    // (and workspace owners/admins, who short-circuit the visibility
    // check) can see it. The user can flip it to public from the
    // folder's options menu later. Defaulting to private avoids the
    // "I keep forgetting to set it private" leak.
    const visibility = createdBy
      ? JSON.stringify({ mode: 'restricted', users: [createdBy] })
      : undefined;

    return this.dbService.db.folders.create({
      parentId: parentId,
      type: 'folder',
      data: name,
      index: index,
      createdBy,
      visibility,
    }).id;
  }

  removeFolder(folderId: string) {
    const info = this.dbService.db.folders.get(folderId);
    if (info === null || info.type !== 'folder') {
      throw new Error('Folder not found');
    }
    const stack = [info];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      if (current.type !== 'folder') {
        this.dbService.db.folders.delete(current.id);
      } else {
        const children = this.dbService.db.folders.find({
          parentId: current.id,
        });
        stack.push(...children);
        this.dbService.db.folders.delete(current.id);
      }
    }
  }

  // MOJO: soft-delete — the folder row stays in the db with trashed=true so
  // the creator or an admin can restore it later from the sidebar Trash.
  trashFolder(folderId: string, trashedBy: string | null) {
    const info = this.dbService.db.folders.get(folderId);
    if (info === null || info.type !== 'folder') {
      throw new Error('Folder not found');
    }
    this.dbService.db.folders.update(folderId, {
      trashed: true,
      trashedBy: trashedBy ?? undefined,
      trashedAt: Date.now(),
    });
  }

  // MOJO: clear the soft-delete flags. Restored folders reappear in the
  // sidebar under their original parent.
  restoreFolder(folderId: string) {
    const info = this.dbService.db.folders.get(folderId);
    if (info === null || info.type !== 'folder') {
      throw new Error('Folder not found');
    }
    this.dbService.db.folders.update(folderId, {
      trashed: false,
      trashedBy: undefined,
      trashedAt: undefined,
    });
  }

  removeLink(linkId: string) {
    const link = this.dbService.db.folders.get(linkId);
    if (link === null || link.type === 'folder') {
      throw new Error('Link not found');
    }
    this.dbService.db.folders.delete(linkId);
  }

  setVisibility(folderId: string, visibility: string) {
    const node = this.dbService.db.folders.get(folderId);
    if (node === null || node.type !== 'folder') {
      throw new Error('Folder not found');
    }
    // Always pass a string (possibly empty) so the ORM overwrites any prior
    // value. Passing undefined would be treated as "no change".
    this.dbService.db.folders.update(folderId, {
      visibility: visibility,
    });
  }

  // MOJO: lock/unlock a folder. Pass `lock` as a JSON string to lock,
  // empty string to unlock. The ORM treats undefined as "no change", so
  // unlocking via update would leave the field stale — we delete + recreate
  // the row's lock state by passing an empty string instead.
  setLock(folderId: string, lock: string) {
    const node = this.dbService.db.folders.get(folderId);
    if (node === null || node.type !== 'folder') {
      throw new Error('Folder not found');
    }
    this.dbService.db.folders.update(folderId, {
      lock: lock,
    });
  }

  // MOJO: walk up from a node id (doc-link or folder) to find the nearest
  // ancestor folder that is locked. Returns the lock JSON string and the
  // folder id, or null if no ancestor is locked. Used to gate editor
  // operations on docs that live inside a locked folder.
  findLockedAncestor(
    nodeId: string
  ): { folderId: string; lock: string } | null {
    const visited = new Set<string>();
    let current: string | undefined = nodeId;
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.dbService.db.folders.get(current);
      if (!info) return null;
      if (info.type === 'folder' && info.lock) {
        return { folderId: info.id, lock: info.lock };
      }
      current = info.parentId ?? undefined;
    }
    return null;
  }

  // MOJO: find the doc-link rows for a given docId across the workspace.
  // A doc may be linked into more than one folder; we return all of them so
  // the caller can check whether ANY ancestor is locked.
  findLinksForDoc(docId: string) {
    return this.dbService.db.folders.find({
      type: 'doc',
      data: docId,
    });
  }

  moveNode(nodeId: string, parentId: string | null, index: string) {
    const node = this.dbService.db.folders.get(nodeId);
    if (node === null) {
      throw new Error('Node not found');
    }

    if (parentId) {
      if (nodeId === parentId) {
        throw new Error('Cannot move a node to itself');
      }
      if (this.isAncestor(parentId, nodeId)) {
        throw new Error('Cannot move a node to its descendant');
      }
      const parent = this.dbService.db.folders.get(parentId);
      if (parent === null || parent.type !== 'folder') {
        throw new Error('Parent folder not found');
      }
    } else {
      if (node.type !== 'folder') {
        throw new Error('Root node can only have folders');
      }
    }
    this.dbService.db.folders.update(nodeId, {
      parentId,
      index,
    });
  }
}
