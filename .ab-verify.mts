// The state an arm left behind, read straight from its database — the arms report on themselves,
// and this is the part that does not take their word for it.
process.env.TASK_SERVER_DATA_DIR = process.argv[2];
const { ensureSchema } = await import("./server/db/migrate.ts");
await ensureSchema();
const { db } = await import("./server/db/client.ts");
const { tasks } = await import("./server/db/schema.ts");

const rows = await db.query.tasks.findMany({
  with: { triggers: true, steps: true },
});
for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`\n${row.name}  enabled=${row.enabled}`);
  for (const trigger of row.triggers) {
    console.log(`   trigger ${trigger.kind} ${trigger.cron || trigger.event} ${trigger.timezone} enabled=${trigger.enabled}`);
  }
  for (const step of row.steps.sort((a, b) => `${a.parentId}${a.position}`.localeCompare(`${b.parentId}${b.position}`))) {
    console.log(`   step ${step.id.slice(0, 8)} parent=${step.parentId?.slice(0, 8) ?? "-"} branch=${step.branch || "-"} pos=${step.position} ${step.kind} "${step.name}" cases=${JSON.stringify(step.cases)}`);
  }
}
process.exit(0);
