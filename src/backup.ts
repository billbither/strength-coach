import { backupDatabase } from "./storage.js";

const target = process.argv[2];
if (!target) throw new Error("Usage: npx tsx src/backup.ts /data/coach-backup.sqlite");
await backupDatabase(target);
console.log(`SQLite backup written to ${target}`);
