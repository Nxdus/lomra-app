import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Bun 1.3.14 on Windows crashes when these suites share a process.
const files = readdirSync(".", { recursive: true })
  .filter((file) => /\.test\.tsx?$/.test(file) && !file.split(/[\\/]/).some((part) => part === "node_modules" || part === ".next"))
  .sort();

if (!files.length) throw new Error("No test files found");
for (const file of files) {
  const result = spawnSync(process.execPath, ["test", `./${file}`], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`All ${files.length} test files passed.`);
