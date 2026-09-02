import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.saybgm.tossinvest.sdPlugin/bin/plugin.js",
    format: "esm",
    sourcemap: false,
  },
  plugins: [
    resolve({ preferBuiltins: true }),
    commonjs(),
    typescript({ tsconfig: "./tsconfig.json" }),
  ],
};
