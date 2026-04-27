import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.config({ extends: ["next/core-web-vitals"] }),
  {
    rules: {
      // set-state-in-effect was added in react-hooks v7 (recommended preset).
      // Existing codebase uses the standard pattern of calling setState inside
      // useEffect conditionals; suppress until the codebase is audited.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
