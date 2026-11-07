// node tools/forms.mjs <dir> <steps>: one frame of each form, for comparing them
import { execFileSync } from "node:child_process";
const [dir, steps = "7000"] = process.argv.slice(2);
for (const form of ["orb", "steps", "ring", "cube"]) {
  console.log(form, execFileSync("node", ["tools/shot.mjs", `${dir}/form-${form}.png`, "--steps", steps, "--query", `form=${form}`], { encoding: "utf8" }).split("\n").filter((l) => l.startsWith("{") || l.startsWith("error: gpu")).join(" ").slice(0, 300));
}
