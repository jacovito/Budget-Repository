import assert from "node:assert/strict"; import test from "node:test"; import { backupNeedsPassword, createBackup, readBackup } from "../app/backup.ts";
const example={profileName:"Test household",plan:{month:"2026-08",incomes:[{id:"pay",amount:4200}]}};
test("standard backups round-trip",async()=>{const text=await createBackup(example);assert.equal(backupNeedsPassword(text),false);assert.deepEqual(await readBackup(text),example)});
test("encrypted backups require the correct password",async()=>{const text=await createBackup(example,"correct horse battery staple");assert.equal(backupNeedsPassword(text),true);await assert.rejects(()=>readBackup(text,"wrong password"),/incorrect|damaged/i);assert.deepEqual(await readBackup(text,"correct horse battery staple"),example)});
test("legacy JSON plan exports can still be restored",async()=>{assert.deepEqual(await readBackup(JSON.stringify(example.plan)),{profileName:"Imported budget",plan:example.plan})});
