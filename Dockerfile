FROM node:24-alpine AS build
WORKDIR /source
COPY package.json package-lock.json ./
COPY . .
RUN npm ci
RUN npm run build

FROM google/shaka-packager:v3.2.0 AS packager

FROM node:24-alpine AS runner
# Node 24 comes from the base image; the packager binary is copied from the
# upstream image (the upstream Alpine 3.19 base only ships Node 20).
COPY --from=packager /usr/bin/packager /usr/bin/packager
RUN apk --no-cache add curl libstdc++ libgcc
RUN apk --no-cache add aws-cli
RUN adduser --system --uid 1001 nodejs
COPY --from=build /source/dist ./dist
COPY --from=build /source/package.json /source/package-lock.json ./
RUN npm ci
RUN npm install -g .
USER nodejs

CMD ["shaka-packager-s3"]
