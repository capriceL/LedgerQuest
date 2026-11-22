import fs from "node:fs";
import path from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node tools/show-topic.mjs <topic-id>");
  process.exit(1);
}

const root = process.cwd();
const files = [
  "content-practice-v1.json",
  "content-law-manual-v1.json",
  "content-finance-v1.json",
];

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(root, "work", file), "utf8"));
  for (const subject of data.subjects) {
    for (const chapter of subject.chapters) {
      const topic = chapter.topics.find((item) => item.id === target);
      if (topic) {
        console.log(JSON.stringify({
          subject: { id: subject.id, name: subject.name, short: subject.short },
          chapter: {
            id: chapter.id,
            no: chapter.no,
            title: chapter.title,
            story: chapter.story,
            outro: chapter.outro,
          },
          topic,
        }, null, 2));
        process.exit(0);
      }
    }
  }
}

console.error(`Topic not found: ${target}`);
process.exit(1);
