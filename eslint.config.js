import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '.vite',
    'artifacts/candidate-evidence',
    'coverage',
    'dist',
    'node_modules',
    'playwright-report',
    'public/assets/transcoders/basis',
    'test-results',
  ]),
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  // The pure layer, enforced rather than described.
  //
  // ARCHITECTURE.md and AGENTS.md §4 both require that simulation, rules and
  // replay state stay independent of Three.js, React and the browser — and the
  // property genuinely holds today: `simulation.ts` imports only its own
  // `./types`, and there is not one browser global in any file below. But that
  // was a fact you could establish only by reading, which means the first
  // import of `three` into the simulation would have been caught in review or
  // not at all.
  //
  // This is the boundary that makes the rest work: it is why a full race can be
  // driven in a Node test with no canvas, why the replay codec and the ghost
  // fold are unit-testable at the fidelity the renderer sees, and why the
  // red team could reproduce finish times exactly rather than estimate them.
  {
    files: [
      'src/game/simulation/**/*.ts',
      'src/game/content/**/*.ts',
      'src/game/replay/**/*.ts',
      'src/game/engine/aiRules.ts',
      'src/game/engine/obstacleContacts.ts',
      'src/game/engine/racePresentation.ts',
      'src/game/engine/tutorialLessonGate.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'three', message: 'The pure layer decides gameplay in plain numbers. Three.js objects are presentation — place the rendering in GameEngine.ts and pass scalars out.' },
          { name: 'react', message: 'The pure layer must be drivable from a Node test with no renderer. Keep React in src/ui.' },
          { name: 'react-dom', message: 'The pure layer must be drivable from a Node test with no renderer. Keep React in src/ui.' },
          { name: 'zustand', message: 'The pure layer takes its inputs as arguments and returns its outputs. Store wiring belongs in src/app.' },
          { name: 'dexie', message: 'The pure layer must not reach storage. Persist through src/game/persistence and pass the loaded value in.' },
        ],
        patterns: [
          { group: ['three/*', 'three/**'], message: 'The pure layer decides gameplay in plain numbers. Three.js objects are presentation.' },
          { group: ['**/persistence/**'], message: 'The pure layer must not reach storage. Load in the caller and pass the value in.' },
          { group: ['**/ui/**', '**/app/store*'], message: 'The pure layer must not depend on presentation or store wiring.' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'The pure layer runs in a Node test with no DOM. Take what you need as an argument.' },
        { name: 'document', message: 'The pure layer runs in a Node test with no DOM. Take what you need as an argument.' },
        { name: 'navigator', message: 'The pure layer runs in a Node test with no DOM. Take what you need as an argument.' },
        { name: 'localStorage', message: 'The pure layer must not reach storage. Pass the loaded value in.' },
        { name: 'sessionStorage', message: 'The pure layer must not reach storage. Pass the loaded value in.' },
        { name: 'indexedDB', message: 'The pure layer must not reach storage. Pass the loaded value in.' },
        { name: 'requestAnimationFrame', message: 'The pure layer advances on the fixed simulation step, never on a frame callback.' },
        { name: 'performance', message: 'The pure layer must stay deterministic. Take elapsed time as an argument.' },
      ],
    },
  },
]);
