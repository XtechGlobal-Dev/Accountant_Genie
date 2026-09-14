# Ingest

CSV statement parsing, normalisation into a canonical row shape, and deduplication before anything
reaches a bank transaction.

| File | What it owns |
|---|---|
| `parse.ts` | Pure CSV parsing: header detection, headerless positional exports, debit/credit pairs, AU dates, `DR`/`CR` suffixes, description normalisation |
| `fingerprint.ts` | The row identity behind `@@unique([bankAccountId, fingerprint])` — re-import is idempotent by construction |
| `schema.ts` | Upload contract and the content sniff (extension, text, columns) |
| `repository.ts` | Import rows and `createMany … skipDuplicates` |
| `service.ts` | Upload → validate → store original → parse → deduplicate → save → reconcile, each stage persisted on the import |
| `actions.ts` | `uploadStatement`, plus the Activity Panel's reads |

The original file is kept under `storage/imports/<firmId>/` (local disk in the prototype; object
storage in Phase 3). Rows that cannot be read are recorded with their reason; the rest still import.
The prototype runs the stages synchronously; the stage markers are the ones a queue worker writes.

Not yet built: PDF statements, a background queue, SSE progress.
