# Codevember 2026

https://akella.github.io/codevember-2026/

Each `NN-name` folder is one experiment, with its own dependencies. On every push to `main`,
GitHub Actions builds `01-fold` to `/1/`, `02-shatter` to `/2/`, and so on. The gallery lists all
30 prompts from `scripts/build.mjs`, and a day becomes a link once its folder exists. Build output
is never committed.

The build adds a footer to every page, linking back to the gallery, so a day needs nothing for that.

## Adding a day

1. Scaffold it with `npm create ssam@latest`, naming the folder `NN-name`.
2. In the new folder, delete `.git`, then remove `ssamGit()` and its import from `vite.config.ts`.
   That plugin runs `git init` on every dev server start, and a nested repo gets pushed as an
   empty folder. The build stops with an error if this step is missed.
3. Optional: add `public/cover.jpg` for the gallery tile.

## Local preview

```sh
npm run build
npm run preview
```
