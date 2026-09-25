# Static image: Caddy serving the game with compression on port 8080.
#   docker build -t tokyo-flyer . && docker run --rm -p 8080:8080 tokyo-flyer
FROM caddy:2.11@sha256:14a9c00d4e833ebc2b65d36515b37bde3b73f0b323a2663aaafc88953d8c4e3f
COPY <<EOF /etc/caddy/Caddyfile
:8080 {
	root * /srv
	encode zstd gzip
	# Revalidate on every load so a new release never mixes with cached modules.
	header Cache-Control no-cache
	file_server
}
EOF
COPY vendor /srv/vendor
COPY index.html style.css /srv/
COPY src /srv/src
