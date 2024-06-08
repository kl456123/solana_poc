import * as fs from "fs";
const fileContent = fs.readFileSync("./demo", { encoding: "utf-8" });

const lines = fileContent.split(/\r?\n/);
let counter = 0;
for (const line of lines) {
  if (line !== "undefined") {
    counter += 1;
  }
}
console.log(counter);
