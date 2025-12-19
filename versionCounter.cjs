const fs = require("fs");
const path = require("path");

const counterFilePath = path.resolve(__dirname, "build-counter.txt");
const packageFilePath = path.resolve(__dirname, "package.json");

const date = new Date();
const year = date.getFullYear();
const month = date.getMonth() + 1;

let counter = 100;

if (fs.existsSync(counterFilePath)) {
  const data = fs.readFileSync(counterFilePath, "utf8");
  const [savedYear, savedMonth, savedCounter] = data.split(".").map(Number);

  if (savedYear === year && savedMonth === month) {
    counter = savedCounter + 1;
  }
}

const version = `${year}.${month}.${counter}`;

fs.writeFileSync(counterFilePath, version);

// package.jsonのバージョンを更新
const packageJson = JSON.parse(fs.readFileSync(packageFilePath, "utf8"));
packageJson.version = version;
fs.writeFileSync(packageFilePath, JSON.stringify(packageJson, null, 2) + "\n");

console.log(`Version updated to ${version}`);
