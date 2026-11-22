import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = [
  "content-practice-v1.json",
  "content-law-manual-v1.json",
  "content-finance-v1.json",
];

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(root, "work", file), "utf8"));
  for (const subject of data.subjects) {
    console.log(`\n## ${subject.name}`);
    for (const chapter of subject.chapters) {
      console.log(`${chapter.no} ${chapter.title} [${chapter.topics.map((topic) => topic.id).join(",")}]`);
      for (const topic of chapter.topics) {
        console.log(`  - ${topic.id} ${topic.title} | ${topic.question.mode}`);
      }
    }
  }
}
