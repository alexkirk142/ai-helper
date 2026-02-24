import * as esbuild from "esbuild";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const rootDir = path.resolve(import.meta.dirname, "..");
const distDir = path.join(rootDir, "dist");

// Clean dist
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}
fs.mkdirSync(distDir, { recursive: true });

// 1. Build Vite frontend → dist/public
console.log("Building client...");
execSync("npx vite build", { cwd: rootDir, stdio: "inherit" });

// 2. Bundle Express server → dist/index.cjs
// Keep all node_modules external — they're available at runtime via node_modules/
const packageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf-8")
);
const allDeps = [
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.devDependencies || {}),
];

console.log("Building server...");
await esbuild.build({
  entryPoints: [path.join(rootDir, "server", "index.ts")],
  outfile: path.join(distDir, "index.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: allDeps,
  define: {
    "import.meta.dirname": "__dirname",
  },
});

console.log("Build complete!");
