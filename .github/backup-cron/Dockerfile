FROM alpine:3.20

RUN apk add --no-cache \
    postgresql16-client \
    aws-cli \
    bash \
    gzip \
    coreutils \
    tzdata

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

# The Railway cron service runs the container on a schedule. The
# container should run the backup once and exit.
CMD ["/backup.sh"]
