FROM node:22.23.3-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json .nvmrc README.md SPEC.md ./
COPY src ./src
COPY extension ./extension
COPY scripts ./scripts
COPY test ./test

RUN npm test

CMD ["npm", "test"]
