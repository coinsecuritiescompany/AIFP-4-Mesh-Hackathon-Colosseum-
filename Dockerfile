FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY . .
ENV PORT=4044
EXPOSE 4044
CMD ["node", "src/index.js"]
