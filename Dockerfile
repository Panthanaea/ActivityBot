FROM node:20-slim

# better-sqlite3 needs build tools to compile its native binding.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# Persist the SQLite file outside the container layer.
VOLUME ["/app/data"]

CMD ["node", "src/index.js"]
