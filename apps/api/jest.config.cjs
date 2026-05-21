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
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
