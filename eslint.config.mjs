import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
export default tseslint.config(
  { ignores: ['dist/**', '.astro/**', 'node_modules/**', 'work/**'] },
  ...tseslint.configs.recommended,
  ...astro.configs['flat/recommended'],
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
