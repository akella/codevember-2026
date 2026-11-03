// Builds every NN-name folder into dist/N/ and writes the gallery to dist/index.html.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");

const run = (command, args, cwd) => {
  const { status } = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (status !== 0) throw new Error(`${command} ${args[0]} failed in ${cwd}`);
};

const days = fs
  .readdirSync(root, { withFileTypes: true })
  .flatMap((entry) => {
    const match = entry.isDirectory() && entry.name.match(/^(\d+)-(.+)$/);
    if (!match) return [];
    const words = match[2].replaceAll("-", " ");
    return {
      folder: entry.name,
      day: Number(match[1]),
      title: words[0].toUpperCase() + words.slice(1),
    };
  })
  .sort((a, b) => a.day - b.day);

// A nested .git makes the parent repo store the folder as an empty gitlink, so
// it shows up here as a folder with no package.json on CI.
for (const [index, { folder, day }] of days.entries()) {
  const cwd = path.join(root, folder);
  if (fs.existsSync(path.join(cwd, ".git"))) {
    throw new Error(`${folder} has its own .git: delete it and remove ssamGit() from its vite.config.ts`);
  }
  if (!fs.existsSync(path.join(cwd, "package.json"))) {
    throw new Error(`${folder} has no package.json: was it committed as an embedded repo?`);
  }
  if (days[index - 1]?.day === day) {
    throw new Error(`${days[index - 1].folder} and ${folder} would both build to dist/${day}/`);
  }
}

fs.rmSync(dist, { recursive: true, force: true });

for (const { folder, day } of days) {
  const cwd = path.join(root, folder);
  const outDir = path.join(dist, String(day));
  if (!fs.existsSync(path.join(cwd, "node_modules"))) run("npm", ["ci"], cwd);
  // vite directly rather than `npm run build`, so a type error can't block a sketch.
  run("npx", ["vite", "build", "--base", "./", "--outDir", outDir, "--emptyOutDir"], cwd);
}

const escapeHtml = (text) =>
  text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

const tiles = days.map(({ day, title }) => {
  const hasCover = fs.existsSync(path.join(dist, String(day), "cover.jpg"));
  const style = hasCover ? ` style="background-image: url(${day}/cover.jpg)"` : "";
  return `<li${style}><a href="./${day}/"><span class="number">${day}</span><span>${escapeHtml(title)}</span></a></li>`;
});

const template = fs.readFileSync(path.join(root, "index.html"), "utf8");
fs.writeFileSync(
  path.join(dist, "index.html"),
  template.replace("<!-- days -->", tiles.join("\n        ")),
);

console.log(`\nBuilt ${days.length} experiment(s) into dist/`);
