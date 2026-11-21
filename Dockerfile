FROM node:22-alpine
WORKDIR /app
COPY . .
ENV HOST=0.0.0.0 PORT=8090 DATA_DIR=/data SECURE_COOKIES=1 NODE_ENV=production
RUN mkdir -p /data && chown node:node /data && chmod +x /app/docker-entrypoint.sh
EXPOSE 8090
CMD ["/app/docker-entrypoint.sh"]
