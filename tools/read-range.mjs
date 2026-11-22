import { readFileSync } from "node:fs";

const [, , file, fromArg, countArg] = process.argv;
const from = Math.max(1, Number(fromArg) || 1);
const count = Math.max(1, Number(countArg) || 80);
const lines = readFileSync(file, "utf8").split(/\r?\n/);

for (let index = from - 1; index < Math.min(lines.length, from - 1 + count); index += 1) {
  process.stdout.write(`${String(index + 1).padStart(5, " ")} | ${lines[index]}\n`);
}
