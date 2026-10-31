import {sqliteTable,text,integer,primaryKey} from 'drizzle-orm/sqlite-core';
export const workspaces=sqliteTable('workspaces',{
  ownerId:text('owner_id').primaryKey(),
  revision:integer('revision').notNull().default(0),
  updatedAt:text('updated_at').notNull(),
  migrationId:text('migration_id'),
  migrationHash:text('migration_hash')
});
export const workspaceRecords=sqliteTable('workspace_records',{
  ownerId:text('owner_id').notNull().references(()=>workspaces.ownerId,{onDelete:'cascade'}),
  kind:text('kind').notNull(),
  entryKey:text('entry_key').notNull(),
  position:integer('position').notNull(),
  payload:text('payload').notNull()
},table=>[primaryKey({columns:[table.ownerId,table.kind,table.entryKey]})]);
