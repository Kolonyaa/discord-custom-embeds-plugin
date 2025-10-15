import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { extname } from "path";
import { createHash } from "crypto";
import { rollup } from "rollup";
import esbuild from "rollup-plugin-esbuild";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import swc from "@swc/core";

const extensions = [".js", ".jsx", ".mjs", ".ts", ".tsx", ".cts", ".mts"];

const plugins = [
  nodeResolve(),
  commonjs(),
  {
    name: "swc",
    async transform(code, id) {
      const ext = extname(id);
      if (!extensions.includes(ext)) return null;
      
      const ts = ext.includes("ts");
      const tsx = ts ? ext.endsWith("x") : undefined;
      const jsx = !ts ? ext.endsWith("x") : undefined;
      
      const result = await swc.transform(code, {
        filename: id,
        jsc: {
          externalHelpers: true,
          parser: {
            syntax: ts ? "typescript" : "ecmascript",
            tsx,
            jsx,
          },
        },
        env: {
          targets: "fully supports es6",
          include: [
            "transform-block-scoping",
            "transform-classes", 
            "transform-async-to-generator",
            "transform-async-generator-functions"
          ],
          exclude: [
            "transform-parameters",
            "transform-template-literals",
            "transform-exponentiation-operator",
            "transform-named-capturing-groups-regex",
            "transform-nullish-coalescing-operator", 
            "transform-object-rest-spread",
            "transform-optional-chaining",
            "transform-logical-assignment-operators"
          ]
        },
      });
      return result.code;
    },
  },
  esbuild({ minify: true }),
];

async function buildPlugin(pluginDir) {
  try {
    const manifestPath = `./plugins/${pluginDir}/manifest.json`;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const outDir = `./dist/${pluginDir}`;
    
    // Create dist directory if it doesn't exist
    await mkdir(outDir, { recursive: true });
    
    const bundle = await rollup({
      input: `./plugins/${pluginDir}/${manifest.main}`,
      onwarn: () => {},
      plugins,
    });
    
    await bundle.write({
      file: `${outDir}/index.js`,
      globals(id) {
        if (id.startsWith("@vendetta")) return id.substring(1).replace(/\//g, ".");
        const map = {
          react: "window.React",
        };
        return map[id] || null;
      },
      format: "iife",
      compact: true,
      exports: "named",
    });
    
    await bundle.close();
    
    const toHash = await readFile(`${outDir}/index.js`);
    manifest.hash = createHash("sha256").update(toHash).digest("hex");
    manifest.main = "index.js";
    
    await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
    console.log(`✅ Successfully built ${manifest.name}!`);
    
  } catch (e) {
    console.error(`❌ Failed to build plugin in ${pluginDir}:`, e);
    process.exit(1);
  }
}

// Main build function
async function main() {
  try {
    console.log("🚀 Starting plugin build...");
    
    // Create dist folder
    await mkdir("./dist", { recursive: true });
    
    // Get all plugin directories
    const plugins = await readdir("./plugins");
    
    if (plugins.length === 0) {
      console.log("❌ No plugins found in ./plugins directory");
      return;
    }
    
    // Build each plugin
    for (const pluginDir of plugins) {
      await buildPlugin(pluginDir);
    }
    
    console.log("🎉 All plugins built successfully!");
    
  } catch (error) {
    console.error("💥 Build failed:", error);
    process.exit(1);
  }
}

main();