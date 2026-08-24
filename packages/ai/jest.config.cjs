/** @type {import('jest').Config} */
module.exports = { rootDir: '.', testEnvironment: 'node', testMatch: ['<rootDir>/src/**/*.spec.ts'], transform: { '^.+\\.ts$': '<rootDir>/../..//apps/api/jest.transform.cjs' }, moduleNameMapper: { '^\\./(.+)\\.js$': './$1', '^\\.\\./(.+)\\.js$': '../$1' }, moduleFileExtensions: ['ts', 'js', 'json'], clearMocks: true };
