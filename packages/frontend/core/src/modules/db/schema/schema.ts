import type { IconData } from '@affine/component';
import {
  type DBSchemaBuilder,
  f,
  type FieldSchemaBuilder,
  type ORMEntity,
  t,
} from '@toeverything/infra';
import { nanoid } from 'nanoid';

import type { WorkspacePropertyType } from '../../workspace-property';

const integrationType = f.enum('readwise');

export const AFFiNE_WORKSPACE_DB_SCHEMA = {
  folders: {
    id: f.string().primaryKey().optional().default(nanoid),
    parentId: f.string().optional(),
    data: f.string(),
    type: f.string(),
    index: f.string(),
    /**
     * MOJO folder visibility (optional; undefined = public).
     * JSON encoded: `{ "mode": "public" | "restricted", "users": [userId, ...] }`
     * UI-level filter only (data still syncs via Yjs to all clients).
     */
    visibility: f.string().optional(),
    /**
     * MOJO: user ID of the account that created this folder.
     * Collaborators can manage visibility on folders they created even
     * though they are not workspace admins.
     */
    createdBy: f.string().optional(),
    /** MOJO: soft-delete flag for folders. Trashed folders are hidden
     *  from the sidebar tree and surfaced in the Trash page. */
    trashed: f.boolean().optional(),
    /** MOJO: user ID that trashed the folder. Used to filter the
     *  per-collaborator Trash view. */
    trashedBy: f.string().optional(),
    /** MOJO: timestamp the folder was trashed. */
    trashedAt: f.number().optional(),
  },
  docProperties: t.document({
    // { [`custom:{customPropertyId}`]: any }
    id: f.string().primaryKey(),
    primaryMode: f.string().optional(),
    edgelessColorTheme: f.string().optional(),
    journal: f.string().optional(),
    pageWidth: f.string().optional(),
    isTemplate: f.boolean().optional(),
    integrationType: integrationType.optional(),
    createdBy: f.string().optional(),
    updatedBy: f.string().optional(),
    /** MOJO: user id of whoever sent this doc to Trash. Used to filter
     *  the per-collaborator Trash view. */
    trashedBy: f.string().optional(),
  }),
  docCustomPropertyInfo: {
    id: f.string().primaryKey().optional().default(nanoid),
    name: f.string().optional(),
    type: f.string() as FieldSchemaBuilder<WorkspacePropertyType, false, false>,
    show: f.enum('always-show', 'always-hide', 'hide-when-empty').optional(),
    index: f.string().optional(),
    icon: f.string().optional(),
    additionalData: f.json().optional(),
    isDeleted: f.boolean().optional(),
    /**
     * MOJO: workspace user id of the collaborator who added this property
     * type. Used to gate removeProperty so collaborators cannot drop
     * property types added by others.
     */
    createdBy: f.string().optional(),
    // we will keep deleted properties in the database, for override legacy data
  },
  pinnedCollections: {
    collectionId: f.string().primaryKey(),
    index: f.string(),
  },
  /**
   * MOJO: workspace-wide index of deadlines set on kanban cards. Written
   * whenever a Deadline cell or its row's Member cell changes. Lets the
   * /deadlines page (and any future calendar widgets) list deadlines
   * without scanning every database block in every doc.
   */
  deadlines: {
    // composite key: `${docId}:${rowId}`
    id: f.string().primaryKey(),
    docId: f.string(),
    rowId: f.string(),
    deadline: f.number(),
    createdBy: f.string().optional(),
    /** JSON-encoded string[] of member user ids assigned to the row. */
    memberIds: f.string().optional(),
    /** Last seen card title, cached so the list view can render it
     *  without opening the doc. */
    title: f.string().optional(),
  },
  /**
   * MOJO: append-only activity log for kanban cards (rows). Surfaced in
   * a per-card "Activity" modal triggered from the card's "..." menu.
   * Written automatically by the database data-source whenever a cell
   * is touched.
   */
  cardActivityLog: {
    id: f.string().primaryKey().optional().default(nanoid),
    rowId: f.string(),
    docId: f.string(),
    timestamp: f.number(),
    actorId: f.string().optional(),
    actorName: f.string().optional(),
    /** Short human-readable headline e.g. "Changed Status", "Renamed". */
    action: f.string(),
    /** JSON string with optional metadata (old/new values, column id,
     *  group keys, etc). */
    details: f.string().optional(),
  },
  explorerIcon: {
    /**
     * ${doc|collection|folder|tag}:${id}
     */
    id: f.string().primaryKey(),
    icon: f.json<IconData>(),
  },
} as const satisfies DBSchemaBuilder;
export type AFFiNEWorkspaceDbSchema = typeof AFFiNE_WORKSPACE_DB_SCHEMA;

export type DocProperties = ORMEntity<AFFiNEWorkspaceDbSchema['docProperties']>;
export type DocCustomPropertyInfo = ORMEntity<
  AFFiNEWorkspaceDbSchema['docCustomPropertyInfo']
>;

export const AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA = {
  favorite: {
    key: f.string().primaryKey(),
    index: f.string(),
    // MOJO: stamp every favourite write with the user that produced
    // it so the FavoriteStore can second-line filter on read. Even if
    // the underlying userdata bucket ever leaks across users (legacy
    // __local__ rows, sync edge cases) the UI will still only show
    // the current user's favourites.
    ownerId: f.string().optional(),
  },
  settings: {
    key: f.string().primaryKey(),
    value: f.json(),
  },
  docIntegrationRef: {
    // docId as primary key
    id: f.string().primaryKey(),
    type: integrationType,
    /**
     * Identify **affine user** and **integration type** and **integration account**
     * Used to quickly find user's all integrations
     */
    integrationId: f.string(),
    refMeta: f.json(),
  },
} as const satisfies DBSchemaBuilder;
export type AFFiNEWorkspaceUserdataDbSchema =
  typeof AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA;
export type DocIntegrationRef = ORMEntity<
  AFFiNEWorkspaceUserdataDbSchema['docIntegrationRef']
>;
