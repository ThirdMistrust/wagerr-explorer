FROM ubuntu:bionic

RUN apt-get update -y
RUN apt-get upgrade -y
RUN apt-get install -y cron bash curl

ENV NODE_VERSION=10.16.2
RUN apt-get update && \
       apt-get install wget curl ca-certificates rsync -y
RUN wget -qO- https://raw.githubusercontent.com/creationix/nvm/v0.33.2/install.sh | bash
ENV NVM_DIR=/root/.nvm
RUN . "$NVM_DIR/nvm.sh" && nvm install ${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" &&  nvm use v${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm alias default v${NODE_VERSION}
RUN cp /root/.nvm/versions/node/v${NODE_VERSION}/bin/node /usr/bin/
RUN cp /root/.nvm/versions/node/v${NODE_VERSION}/bin/npm /usr/bin/
RUN /root/.nvm/versions/node/v${NODE_VERSION}/bin/npm install  leasot@latest -g

WORKDIR /explorer

RUN npm cache clean --force
RUN npm install -g webpack
RUN npm install -g webpack-cli

COPY package.json /explorer
#COPY docker/node/install.sh /root/install.sh
#COPY docker/node/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN npm install -g yarn node-gyp
RUN npm install
RUN yarn install

COPY . .

ADD crontab /etc/cron.d/hello-cron
RUN chmod 0644 /etc/cron.d/hello-cron
RUN crontab /etc/cron.d/hello-cron
RUN touch /var/log/cron.log

EXPOSE 8087
EXPOSE 8081

CMD ["script/start.sh"]