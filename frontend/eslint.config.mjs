import nextConfig from "eslint-config-next/core-web-vitals";

export default [
  ...nextConfig,
  {
    rules: {
      // set-state-in-effect was added in react-hooks v7 (recommended preset).
      // Existing codebase uses the standard pattern of calling setState inside
      // useEffect conditionals; suppress until the codebase is audited.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
