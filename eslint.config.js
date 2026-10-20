// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

/**
 * Most of what is enabled beyond the recommended sets exists to turn a rule that
 * lived in CLAUDE.md prose into one the machine checks. A rule nobody can forget
 * is worth more than a rule everybody agrees with.
 */
module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      // strictTypeChecked, not recommended: the project's rule is that typing is
      // always strict, and the type-aware set is the only one that can see an
      // unsafe `any` crossing a boundary or a promise nobody awaited.
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    // Typed linting: the rules that catch the expensive mistakes — an uncalled
    // signal, a computed with no return — cannot work without type information.
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],

      // ── Angular conventions this project already commits to ─────────────────
      '@angular-eslint/prefer-inject': 'error',
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-output-emitter-ref': 'error',
      '@angular-eslint/prefer-output-readonly': 'error',
      '@angular-eslint/prefer-standalone': 'error',
      // host object instead of @HostBinding / @HostListener
      '@angular-eslint/prefer-host-metadata-property': 'error',
      '@angular-eslint/use-lifecycle-interface': 'error',
      '@angular-eslint/relative-url-prefix': 'error',
      '@angular-eslint/no-async-lifecycle-method': 'error',
      '@angular-eslint/no-conflicting-lifecycle': 'error',
      '@angular-eslint/no-empty-lifecycle-method': 'error',
      '@angular-eslint/contextual-lifecycle': 'error',

      // ── Signals: the mistakes that fail silently ────────────────────────────
      // (computed-must-return and no-implicit-take-until-destroyed arrive with angular-eslint 21)
      // `if (mySignal)` is always truthy — the classic signals bug
      '@angular-eslint/no-uncalled-signals': 'error',

      // ── Size limits from CLAUDE.md ─────────────────────────────────────────
      // CLAUDE.md says 15 lines of *body*. ESLint counts the signature, the
      // closing brace, and every line of a multi-line argument — a `.subscribe({
      // next, error })` costs a dozen lines that are not logic. 20 is that rule
      // measured the way this counter measures; anything past it is genuinely long.
      'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],

      // ── Types ──────────────────────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      // A component whose whole job is its template has no members, and that is
      // not a smell — the decorator is what makes the class meaningful.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],

      // `effect(() => this.load())` is the shape this project is
      // built on; demanding braces around every one of them is noise, not safety.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // `id-${index}` is a string template doing exactly what it looks like
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `output<void>()` is the Angular idiom for an event with no payload
      '@typescript-eslint/no-invalid-void-type': ['error', { allowAsThisParameter: true }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    // Specs, e2e and test helpers are full of deliberate no-op stubs: a fake
    // ResizeObserver, a matchMedia shim, an error callback that must swallow.
    // An empty body there is the point, not an oversight. `describe` blocks are
    // long by nature, so the size limit does not apply either.
    files: ['**/*.spec.ts', 'e2e/**/*.ts', 'src/**/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
      'max-lines-per-function': 'off',
      // A stub component that stands in for a real one in a TestBed has no change
      // detection story worth having.
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',

      // A mock is untyped by construction: a spy returns `any`, and a fake
      // service is a shape, not an implementation. Demanding provenance from it
      // buys nothing — the code that ships stays under the full strict set, which
      // is where the guarantee actually matters.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Protected members are reached by index on purpose in this project
      '@typescript-eslint/dot-notation': 'off',
      // `expect(x).toBe(...)` on a void-returning spy is the normal shape
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Asserting that a fixture really is what it claims is the test's job, even
      // when the type says the check is redundant.
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      // ── Template syntax this project already commits to ─────────────────────
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-ngsrc': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/prefer-at-empty': 'error',
      '@angular-eslint/template/use-track-by-function': 'error',
      '@angular-eslint/template/no-duplicate-attributes': 'error',
      '@angular-eslint/template/eqeqeq': 'error',
      '@angular-eslint/template/no-any': 'error',

      // ── Accessibility beyond the recommended set ────────────────────────────
      // accessibility is a hard requirement here, so these are errors
      '@angular-eslint/template/button-has-type': 'error',
      '@angular-eslint/template/no-positive-tabindex': 'error',
      '@angular-eslint/template/no-autofocus': 'error',
      '@angular-eslint/template/no-distracting-elements': 'error',

      // ── "Avoid overly complex logic in templates" — Angular style guide ─────
      '@angular-eslint/template/conditional-complexity': ['error', { maxComplexity: 3 }],
      // The annotator toolbar and sidebar legitimately branch on document / dirty / encrypted,
      // each with its own empty case. 15 is where a template stops being readable.
      '@angular-eslint/template/cyclomatic-complexity': ['error', { maxComplexity: 15 }],
    },
  },
]);
