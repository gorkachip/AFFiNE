import type { DocMode } from '@blocksuite/affine/model';
import type { DocMeta } from '@blocksuite/affine/store';
import { Entity, LiveData } from '@toeverything/infra';

import type { DocProperties } from '../../db';
import type { DocPropertiesStore } from '../stores/doc-properties';
import type { DocsStore } from '../stores/docs';

/**
 * # DocRecord
 *
 * Some data you can use without open a doc.
 */
export class DocRecord extends Entity<{ id: string }> {
  id: string = this.props.id;
  constructor(
    private readonly docsStore: DocsStore,
    private readonly docPropertiesStore: DocPropertiesStore
  ) {
    super();
  }

  meta$ = LiveData.from<Partial<DocMeta>>(
    this.docsStore.watchDocMeta(this.id),
    {}
  );

  properties$ = LiveData.from<DocProperties>(
    this.docPropertiesStore.watchDocProperties(this.id),
    { id: this.id }
  );

  property$(propertyId: string) {
    return this.properties$.selector(p => p[propertyId]) as LiveData<
      string | undefined | null
    >;
  }

  customProperty$(propertyId: string) {
    return this.properties$.selector(
      p => p['custom:' + propertyId]
    ) as LiveData<string | undefined | null>;
  }

  setCustomProperty(propertyId: string, value: string) {
    this.docPropertiesStore.updateDocProperties(this.id, {
      ['custom:' + propertyId]: value,
    });
  }

  getProperties() {
    return this.docPropertiesStore.getDocProperties(this.id);
  }

  updateProperties(properties: Partial<DocProperties>) {
    this.docPropertiesStore.updateDocProperties(this.id, properties);
  }

  setProperty<Key extends keyof DocProperties>(
    propertyId: Key,
    value: DocProperties[Key]
  ) {
    this.docPropertiesStore.updateDocProperties(this.id, {
      [propertyId]: value,
    });
  }

  setMeta(meta: Partial<DocMeta>): void {
    this.docsStore.setDocMeta(this.id, meta);
  }

  primaryMode$: LiveData<DocMode> = LiveData.from(
    this.docsStore.watchDocPrimaryModeSetting(this.id),
    'page' as DocMode
  ).map(mode => (mode === 'edgeless' ? 'edgeless' : 'page') as DocMode);

  setPrimaryMode(mode: DocMode) {
    return this.docsStore.setDocPrimaryModeSetting(this.id, mode);
  }

  getPrimaryMode() {
    return this.docsStore.getDocPrimaryModeSetting(this.id);
  }

  /**
   * MOJO: enforce that only the doc creator or a workspace owner/admin
   * can move a doc to trash. This is the single chokepoint that every
   * upstream "delete doc" path eventually calls, so guarding here covers
   * sidebar menus, doc page header, /all list, journal tab, command
   * palette, etc.
   *
   * Detection of the current user/admin happens via globals injected at
   * boot (see useMojoAuthBridge in the app shell): we don't import
   * AuthService here to avoid circular deps in the doc module.
   */
  moveToTrash() {
    const ctx = (globalThis as any).__mojoAuthContext as
      | { userId: string | null; isOwnerOrAdmin: boolean }
      | undefined;
    // MOJO: locked folder takes precedence over the regular permission
    // check — even an admin must unlock first. This makes the lock
    // intent explicit ("I clicked unlock") rather than silently
    // overridden by elevated privileges.
    const lockChecker = (globalThis as any).__mojoFolderLockChecker as
      | { isDocLocked: (docId: string) => boolean }
      | undefined;
    if (lockChecker?.isDocLocked(this.id)) {
      throw new Error(
        'This document is in a locked folder. Unlock the folder first (admins only).'
      );
    }
    if (ctx) {
      const createdBy = this.property$('createdBy').value as string | undefined;
      const isCreator = !!ctx.userId && !!createdBy && ctx.userId === createdBy;
      if (!ctx.isOwnerOrAdmin && !isCreator) {
        throw new Error(
          'You do not have permission to delete this document. Only the creator or a workspace admin can move it to trash.'
        );
      }
    }
    // MOJO: remember who trashed the doc so the sidebar Trash can show
    // each collaborator only their own trashed items.
    if (ctx?.userId) {
      this.updateProperties({ trashedBy: ctx.userId });
    }
    return this.setMeta({ trash: true, trashDate: Date.now() });
  }

  restoreFromTrash() {
    // Clear the trashedBy attribution on restore so if someone else
    // trashes the same doc later we don't mis-attribute it.
    this.updateProperties({ trashedBy: undefined });
    return this.setMeta({ trash: false, trashDate: undefined });
  }

  title$ = this.meta$.map(meta => meta.title ?? '');

  trash$ = this.meta$.map(meta => meta.trash ?? false);

  createdAt$ = this.meta$.map(meta => meta.createDate);

  updatedAt$ = this.meta$.map(meta => meta.updatedDate);

  createdBy$ = this.property$('createdBy');

  updatedBy$ = this.property$('updatedBy');

  setCreatedAt(createdAt: number) {
    this.setMeta({ createDate: createdAt });
  }

  setUpdatedAt(updatedAt: number) {
    this.setMeta({ updatedDate: updatedAt });
  }

  setCreatedBy(createdBy: string) {
    this.setProperty('createdBy', createdBy);
  }

  setUpdatedBy(updatedBy: string) {
    this.setProperty('updatedBy', updatedBy);
  }
}
