// Builds every NN-name folder into dist/N/ and writes the gallery to dist/index.html.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");

const prompts = [
  "Fold",
  "Shatter",
  "Melt",
  "Tangle",
  "Moss",
  "Orrery",
  "Hollow",
  "Tesseract",
  "Membrane",
  "Caustic",
  "Rust",
  "Feather",
  "Labyrinth",
  "Tension",
  "Mirage",
  "Spore",
  "Kelp",
  "Pendulum",
  "Erosion",
  "Cocoon",
  "Bolt",
  "Echo",
  "Magma",
  "Nest",
  "Veil",
  "Anamorph",
  "Burrow",
  "Hive",
  "Portal",
  "Dissolve",
];

// Added to every built page, so that each experiment leads back to the list without having to know about it.
// Difference blending keeps it readable on whatever the piece draws behind it.
const footer = (day, folder) => `
    <style>
      #codevember {
        position: fixed;
        left: 12px;
        bottom: 10px;
        z-index: 1000;
        font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        color: #fff;
        mix-blend-mode: difference;
      }
      #codevember a {
        color: inherit;
        text-decoration: none;
      }
      #codevember a:hover {
        text-decoration: underline;
      }
    </style>
    <footer id="codevember">
      <a href="../">← Codevember 2026</a> · ${day} ${prompts[day - 1]} · Yuri Artiukh
      <a href="https://github.com/akella/codevember-2026/tree/main/${folder}">github</a>
    </footer>
`;

const run =(command, args, cwd) => {
  const { status } = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (status !== 0) throw new Error(`${command} ${args[0]} failed in ${cwd}`);
};

const days = fs
  .readdirSync(root, { withFileTypes: true })
  .flatMap((entry) => {
    const match = entry.isDirectory() && entry.name.match(/^(\d+)-.+$/);
    return match ? { folder: entry.name, day: Number(match[1]) } : [];
  })
  .sort((a, b) => a.day - b.day);

// A nested .git makes the parent repo store the folder as an empty gitlink, so
// it shows up here as a folder with no package.json on CI.
for (const [index, { folder, day }] of days.entries()) {
  const cwd = path.join(root, folder);
  if (!prompts[day - 1]) {
    throw new Error(`${folder} is outside days 1-${prompts.length}, so the gallery would not show it`);
  }
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
  // a day can have more than one page, and they all sit at the top of its folder
  for (const name of fs.readdirSync(outDir).filter((file) => file.endsWith(".html"))) {
    const page = path.join(outDir, name);
    fs.writeFileSync(page, fs.readFileSync(page, "utf8").replace("</body>", `${footer(day, folder)}  </body>`));
  }
}

const tiles = prompts.map((prompt, index) => {
  const day = index + 1;
  const label = `<span class="number">${day}</span><span>${prompt}</span>`;
  if (!days.some((built) => built.day === day)) {
    return `<li class="soon"><div>${label}</div></li>`;
  }
  const hasCover = fs.existsSync(path.join(dist, String(day), "cover.jpg"));
  const style = hasCover ? ` style="background-image: url(${day}/cover.jpg)"` : "";
  return `<li${style}><a href="./${day}/">${label}</a></li>`;
});

const template = fs.readFileSync(path.join(root, "index.html"), "utf8");
fs.writeFileSync(
  path.join(dist, "index.html"),
  template.replace("<!-- days -->", tiles.join("\n        ")),
);

console.log(`\nBuilt ${days.length} experiment(s) into dist/`);
