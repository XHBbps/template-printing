module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  setupFiles: ['<rootDir>/test/setup.ts'],
  moduleNameMapper: {
    '^@template-printing/types$': '<rootDir>/../../packages/types/src/index.ts',
    '^@template-printing/schema$': '<rootDir>/../../packages/schema/src/index.ts',
    // file-type v19 is pure-ESM; redirect to a CJS-compatible shim for Jest
    '^file-type$': '<rootDir>/test/__mocks__/file-type.cjs',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
