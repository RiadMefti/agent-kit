import { $ } from "bun";

// Stub out react-devtools-core so the bundler resolves it to an empty module
// instead of leaving a bare import that fails at runtime
await Bun.write("./dist/_devtools-stub.js", "export default {};\n");

await Bun.build({
  entrypoints: ["./index.tsx"],
  outdir: "./dist",
  target: "bun",
  minify: true,
  naming: "cli.js",
  banner: "#!/usr/bin/env bun",
  plugins: [
    {
      name: "stub-devtools",
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: new URL("../dist/_devtools-stub.js", import.meta.url).pathname,
        }));
      },
    },
  ],
});

await $`chmod +x ./dist/cli.js`;
await $`rm -f ./dist/_devtools-stub.js`;

console.log("Build complete: dist/cli.js");
