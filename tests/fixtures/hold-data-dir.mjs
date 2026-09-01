// Opens the server's database against TASK_SERVER_DATA_DIR and says which way it went: `HELD`
// and then stays alive holding the directory, or `REFUSED` with the reason. Plain node, no
// tsx — the same type stripping the container runs `server/` under.
try {
  await import("../../server/db/client.ts");
  console.log("HELD");
  setInterval(() => {}, 1 << 30);
} catch (error) {
  console.log(`REFUSED ${String(error.message).replace(/\s+/g, " ")}`);
  process.exit(1);
}
