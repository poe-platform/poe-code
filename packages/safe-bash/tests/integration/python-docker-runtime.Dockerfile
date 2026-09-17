ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /runtime
COPY runtime/ /runtime/
LABEL org.poe-platform.python-executor="1"
USER 65534:65534
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["/runtime/python-executor.mjs"]
