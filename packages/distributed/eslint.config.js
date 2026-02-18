import { createTypeScriptConfig } from '../../eslint.shared.mjs';

export default createTypeScriptConfig({
  tsconfigRootDir: import.meta.dirname,
  extraTestRules: {
    '@typescript-eslint/require-await': 'off',
    '@typescript-eslint/no-unnecessary-condition': 'off',
    '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-require-imports': 'off',
  },
});
