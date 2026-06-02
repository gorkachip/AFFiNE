import { Store } from '@toeverything/infra';

import type { WorkspaceDBService } from '../../db';

// MOJO: workspace owners/admins bypass every folder-lock guard — they
// can rename / create / move / delete content inside locked folders
// without unlocking. The auth context is installed by MojoAuthBridge
// at the workspace root; if it's not there yet (very early boot) we
// fail closed and the guard still fires.
function isAdminBypass(): boolean {
  const ctx = (globalThis as any).__mojoAuthContext as
    | { isOwnerOrAdmin?: boolean }
    | undefined;
  return !!ctx?.isOwnerOrAdmin;
}

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
    // MOJO: same rule as createFolder — no adding items into a locked
    // folder (or anything below one). Workspace owners/admins bypass.
    if (!isAdminBypass()) {
      const lockedAncestor = this.findLockedAncestor(parentId);
      if (lockedAncestor) {
        throw new Error(
          'Cannot add items to a locked folder. Unlock the parent first (admins only).'
        );
      }
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
    // MOJO: locked folders (or descendants of locked folders) cannot be
    // renamed. setLock itself bypasses by writing the `lock` field, not
    // the data/name field, so the toggle keeps working. Workspace
    // owners/admins bypass entirely.
    if (!isAdminBypass()) {
      if (node.lock) {
        throw new Error(
          'Folder is locked. Unlock it first to rename (admins only).'
        );
      }
      const ancestorLocked = this.findLockedAncestor(nodeId);
      if (ancestorLocked) {
        throw new Error(
          'Folder is inside a locked folder. Unlock the parent first (admins only).'
        );
      }
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
      // MOJO: a locked folder freezes its contents — no creating new
      // children inside it (nor inside any descendant of a locked
      // folder). findLockedAncestor walks from the parent up, so it
      // catches both the immediate parent and higher ancestors.
      // Workspace owners/admins bypass.
      if (!isAdminBypass()) {
        const lockedAncestor = this.findLockedAncestor(parentId);
        if (lockedAncestor) {
          throw new Error(
            'Cannot create folder inside a locked folder. Unlock the parent first (admins only).'
          );
        }
      }
    }

    // MOJO: visibility defaults depend on where the folder is created.
    //
    // - SUBFOLDER (parentId set): default to 'inherit' so the share of
    //   the parent cascades down automatically. The user can override
    //   per-folder to public or specific-people from the Share dialog.
    //
    // - ROOT FOLDER: default to restricted-to-creator so a fresh top-
    //   level folder isn't exposed workspace-wide until explicitly shared.
    //   Root folders have no parent to inherit from, so 'inherit' would
    //   degrade to public (see resolveEffectiveVisibility).
    const visibility = parentId
      ? JSON.stringify({ mode: 'inherit' })
      : createdBy
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
    // MOJO: a locked folder (or any ancestor that's locked) cannot be
    // trashed by regular users. Workspace owners/admins bypass.
    if (!isAdminBypass()) {
      if (info.lock) {
        throw new Error(
          'Folder is locked. Unlock it first (admins only).'
        );
      }
      const ancestorLocked = this.findLockedAncestor(folderId);
      if (ancestorLocked) {
        throw new Error(
          'Folder is inside a locked folder. Unlock the parent first (admins only).'
        );
      }
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
    // MOJO: refuse "Remove from folder" when the parent (or any
    // ancestor of the parent) is locked. For doc-links specifically,
    // a user with Doc_Users_Manage on the underlying doc bypasses
    // the lock — same rule as the editor read-only override.
    // Workspace owners/admins bypass entirely (admin > everything).
    if (!isAdminBypass()) {
      const locked = this.findLockedAncestor(linkId);
      if (locked) {
        const checker = (globalThis as any).__mojoFolderLockChecker as
          | { isDocLocked: (docId: string) => boolean }
          | undefined;
        const docId = link.type === 'doc' ? link.data : null;
        const stillLocked = docId
          ? (checker?.isDocLocked(docId) ?? true)
          : true;
        if (stillLocked) {
          throw new Error(
            'This item is inside a locked folder. Unlock the folder first (admins only).'
          );
        }
      }
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

  // MOJO: resolve a folder's effective visibility by walking up through
  // any 'inherit' ancestors. Returns the nearest non-inherit visibility,
  // or public if the lineage hits the root while still inheriting (an
  // orphan inherit shouldn't ghost a folder out of view). Parses the raw
  // JSON inline to avoid importing folder-visibility from the store
  // module (would create a circular dep with the service module).
  resolveEffectiveVisibility(folderId: string): {
    mode: 'public' | 'restricted';
    users: string[];
  } {
    const visited = new Set<string>();
    let current: string | undefined = folderId;
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.dbService.db.folders.get(current);
      if (!info || info.type !== 'folder') {
        return { mode: 'public', users: [] };
      }
      const raw = info.visibility;
      if (!raw) return { mode: 'public', users: [] };
      try {
        const parsed = JSON.parse(raw) as {
          mode?: string;
          users?: string[];
        };
        if (parsed.mode === 'restricted') {
          return {
            mode: 'restricted',
            users: Array.isArray(parsed.users) ? parsed.users : [],
          };
        }
        if (parsed.mode === 'public' || parsed.mode === undefined) {
          return { mode: 'public', users: [] };
        }
        // inherit — keep walking up
      } catch {
        return { mode: 'public', users: [] };
      }
      current = info.parentId ?? undefined;
    }
    return { mode: 'public', users: [] };
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

  // MOJO: streaming variant of findLinksForDoc, used by FolderTree to
  // recompute lock state reactively whenever a doc-link is added/removed.
  watchLinksForDoc(docId: string) {
    return this.dbService.db.folders.find$({
      type: 'doc',
      data: docId,
    });
  }

  // MOJO: streaming variant for "any folder anywhere in the workspace".
  // Used to invalidate computed lock-for-doc state when a folder is
  // locked or unlocked higher up in the tree.
  watchAllFolders() {
    return this.dbService.db.folders.find$({
      type: 'folder',
    });
  }

  moveNode(nodeId: string, parentId: string | null, index: string) {
    const node = this.dbService.db.folders.get(nodeId);
    if (node === null) {
      throw new Error('Node not found');
    }

    // MOJO: locked-folder enforcement. We refuse the move if EITHER the
    // current parent OR the target parent has a locked ancestor. This
    // covers both "drag out of a locked folder" and "drop into a locked
    // folder", regardless of which UI path triggered it. For doc-links,
    // Doc_Users_Manage on the underlying doc bypasses both checks.
    // Workspace owners/admins bypass entirely.
    if (!isAdminBypass()) {
      const checker = (globalThis as any).__mojoFolderLockChecker as
        | { isDocLocked: (docId: string) => boolean }
        | undefined;
      const docIdForBypass = node.type === 'doc' ? node.data : null;
      const isLinkBypassed =
        !!docIdForBypass && checker?.isDocLocked(docIdForBypass) === false;
      const sourceLocked = this.findLockedAncestor(nodeId);
      if (sourceLocked && !isLinkBypassed) {
        throw new Error(
          'This item is inside a locked folder. Unlock the folder first (admins only).'
        );
      }
      if (parentId) {
        const targetLocked = this.findLockedAncestor(parentId);
        if (targetLocked && !isLinkBypassed) {
          throw new Error(
            'The destination folder is locked. Unlock it first (admins only).'
          );
        }
      }
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
