FROM node:20-alpine

WORKDIR /app
# Ensure OpenSSL and build tools are available if needed by deps
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
# Install deps (regenerate lock to include newly added devDependencies like tailwindcss)
RUN npm install

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]



