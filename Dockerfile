FROM node:20-alpine

WORKDIR /app

# Instalar dependencias
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el código del proyecto
COPY . .

ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000

CMD ["node", "puente-whatsapp.mjs"]
