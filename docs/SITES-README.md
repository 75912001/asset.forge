# Asset Forge

Account-owned game configuration editor, hosted on the existing private Sites project. The editor remains in `public/editor/`; the root route serves it without changing the Site origin. D1 stores the workspace revision and individual category, schema, enum and asset records.

## First migration

1. On the original computer, use the original browser and Site URL. Sign in to the same ChatGPT account.
2. Check the detected category, enum and row counts. Click `下载备份并迁移到云端` and keep the downloaded JSON backup.
3. Wait for the cloud version to appear. The original `asset-forge-workspace-v2` and legacy category storage are not removed or overwritten.
4. On the second computer, sign in to the same account and open or reload the Site. Do not initialize cloud data from default categories.

Cloud saves happen only through the existing Save buttons. On a conflict, download the complete local draft backup, then load the latest cloud workspace and manually reapply the desired edits. There is no force-overwrite endpoint. Failed saves keep the draft; a reopened page offers explicit draft recovery. Each device selects its own local export folder. YAML file structure remains unchanged.

## Verification

- `npm test`: model, SQLite-backed API, client state and app handler regression tests.
- `node --import ./scripts/sites-env.mjs test/d1-integration.mjs`: real local D1 simulation with 10000 rows, exact integer preservation, account isolation, concurrent saves and rollback after an injected SQL failure.
- Use the Sites build helper for production builds. Apply generated SQL migrations to the local D1 before previewing; Sites applies hosted schema migrations during deployment.

The original browser data is never bundled into source, migrations or deployment archives. Local preview data and production data are separate. The portable starter's local sign-in is test-only and is excluded from the production build.
