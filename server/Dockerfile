FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
RUN mkdir /app/runtime && chown node:node /app/runtime
USER node
EXPOSE 3002
CMD ["node", "src/server.js"]
