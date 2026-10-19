# Pounce

Core TypeScript library for deterministic keyboard-first target ranking and
numeric hints. The current scope is browser-independent plain data.

## Requirements

- Node.js `22.23.3` (see `.nvmrc`)
- npm 10+

## Setup

```sh
npm ci
```

## Run

Build the library into `dist/`:

```sh
npm run build
```

## Test

```sh
npm test
```

## Package / deploy

Create the distributable npm archive locally:

```sh
npm pack
```

Publishing requires npm authentication and an intentional release version:

```sh
npm version <version>
npm publish
```

The Docker image runs the same offline-capable test command:

```sh
docker build -t pounce .
docker run --rm pounce
```
