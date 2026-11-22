import { readFileSync } from "node:fs";

const file = process.argv[2] || "LedgerQuest.html";
const html = readFileSync(file, "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if (scripts.length !== 1) {
  console.error(`Expected exactly one inline script, found ${scripts.length}.`);
  process.exitCode = 1;
}

for (const [index, match] of scripts.entries()) {
  try {
    new Function(match[1]);
    console.log(`Script ${index + 1}: syntax OK (${match[1].length} chars)`);
  } catch (error) {
    console.error(`Script ${index + 1}: syntax error`);
    console.error(error.stack);
    process.exitCode = 1;
  }
}

const external = [
  ...html.matchAll(/<(?:script|link|img)[^>]+(?:src|href)\s*=\s*["'](https?:|\/\/)[^"']+["']/gi)
].map((match) => match[0]);
if (external.length) {
  console.error("External dependencies found:");
  external.forEach((item) => console.error(item));
  process.exitCode = 1;
} else {
  console.log("External dependencies: none");
}

console.log(`File size: ${Buffer.byteLength(html, "utf8")} bytes`);
