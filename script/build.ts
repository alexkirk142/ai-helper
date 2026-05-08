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
// External prod + optional deps (runtime node_modules); do not blanket-external devDeps
// so a stray server import from a dev-only package fails the bundle.
//
// Dynamic `import("./vite")` still pulls vite.config → @vitejs/plugin-react — those packages
// are devDependency-only but must stay external or esbuild tries to bundle Vite (babel/lightningcss native graph).
const devToolchainExternals = ["vite", "@vitejs/plugin-react", "esbuild"] as const;

const packageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf-8")
);
const allDeps = [
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.optionalDependencies || {}),
  ...devToolchainExternals,
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
