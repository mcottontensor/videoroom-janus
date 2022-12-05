FROM node:19.1.0

RUN apt-get update && apt-get install -y meson libtool libjansson-dev libssl-dev libffi-dev cmake libglib2.0-dev libconfig-dev git
WORKDIR videoroom

RUN git clone https://gitlab.freedesktop.org/libnice/libnice && cd libnice && meson --prefix=/usr build && ninja -C build && ninja -C build install
RUN wget https://github.com/cisco/libsrtp/archive/v2.2.0.tar.gz && tar xfv v2.2.0.tar.gz && cd libsrtp-2.2.0 && sh ./configure --prefix=/usr --enable-openssl && make shared_library && make install && cd .. && rm -rf v2.2.0.tar.gz
RUN git clone https://github.com/sctplab/usrsctp && cd usrsctp && sh ./bootstrap && sh ./configure --prefix=/usr --disable-programs --disable-inet --disable-inet6 && make && make install
RUN git clone https://libwebsockets.org/repo/libwebsockets && cd libwebsockets && git checkout v3.2-stable && cmake -DLWS_MAX_SMP=1 -DLWS_WITHOUT_EXTENSIONS=0 -DCMAKE_INSTALL_PREFIX:PATH=/usr -DCMAKE_C_FLAGS="-fpic" . && make && make install
RUN git clone https://github.com/meetecho/janus-gateway.git && cd janus-gateway && sh autogen.sh && sh ./configure --prefix=/opt/janus && make && make install && make configs

COPY config.js app.js package.json ./
COPY public public
COPY server/ssl server/ssl
COPY janus.jcfg janus.transport.websockets.jcfg /opt/janus/etc/janus/

RUN npm install
RUN npm run build
