FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run chat:backend:typecheck

ENV NODE_ENV=production
ENV PORT=8788

EXPOSE 8788

CMD ["npm", "run", "chat:backend"]
