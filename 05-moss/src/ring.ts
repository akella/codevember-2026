import { createPiece, forms, type FormName } from "./piece";

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
const loading = document.querySelector("#loading")!;
const hint = document.querySelector("#hint")!;
const picker = document.querySelector("#forms")!;

const asked = new URLSearchParams(location.search).get("form");

const piece = await createPiece(canvas, asked && asked in forms ? { form: asked as FormName } : {}, () => hint.classList.add("gone")).catch((error) => {
  console.error(error);
  loading.textContent = String(error.message ?? error);
});

if (piece) {
  loading.remove();
  if (navigator.maxTouchPoints > 0) hint.textContent = "tap the stone to plant moss · pinch to look closer";
  hint.classList.remove("gone");

  const show = () => picker.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.textContent === piece.settings.form));
  for (const name of Object.keys(forms) as FormName[]) {
    const button = document.createElement("button");
    button.textContent = name;
    button.addEventListener("click", async () => {
      await piece.grow(name);
      show();
    });
    picker.append(button);
  }
  show();

  const other = document.createElement("a");
  other.href = "./";
  other.textContent = "triangle";
  picker.append(other);
}
