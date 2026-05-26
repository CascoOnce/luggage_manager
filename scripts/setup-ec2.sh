#!/usr/bin/env bash
# One-time EC2 provisioning script for Luggage Manager.
# Run once as root on a fresh Ubuntu 24.04 instance:
#   sudo bash setup-ec2.sh
set -euo pipefail

APP_USER=ubuntu
APP_DIR=/opt/luggage-manager
WEB_DIR=/var/www/luggage-manager

echo "==> Installing dependencies"
apt-get update -q
apt-get install -y -q openjdk-21-jre-headless nginx

echo "==> Creating application directories"
mkdir -p "$APP_DIR" "$WEB_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR" "$WEB_DIR"

echo "==> Creating placeholder .env (fill in real values)"
cat > "$APP_DIR/.env" << 'ENV'
SPRING_DATASOURCE_URL=jdbc:mysql://YOUR_RDS_HOST:3306/tasfb2b?useSSL=true&serverTimezone=UTC
SPRING_DATASOURCE_USERNAME=admin
SPRING_DATASOURCE_PASSWORD=changeme
SPRING_PROFILES_ACTIVE=prod
ENV
chmod 600 "$APP_DIR/.env"
chown "$APP_USER:$APP_USER" "$APP_DIR/.env"

echo "==> Installing systemd service"
cat > /etc/systemd/system/luggage-manager.service << SERVICE
[Unit]
Description=Luggage Manager – Spring Boot backend
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/java -jar $APP_DIR/app.jar
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=luggage-manager

[Install]
WantedBy=multi-user.target
SERVICE

echo "==> Configuring Nginx"
# Remove default site
rm -f /etc/nginx/sites-enabled/default

cp /dev/stdin /etc/nginx/sites-available/luggage-manager << 'NGINX'
server {
    listen 80;
    server_name _;

    root /var/www/luggage-manager;
    index index.html;

    # React SPA – unknown paths fall back to index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy all /api/* calls to the Spring Boot backend
    location /api/ {
        proxy_pass         http://127.0.0.1:8080/api/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_read_timeout    300s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/luggage-manager /etc/nginx/sites-enabled/luggage-manager
nginx -t

echo "==> Granting ubuntu passwordless sudo for service control"
cat > /etc/sudoers.d/luggage-manager << SUDOERS
$APP_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart luggage-manager, /bin/systemctl start luggage-manager, /bin/systemctl stop luggage-manager, /bin/systemctl status luggage-manager, /bin/journalctl -u luggage-manager *
SUDOERS
chmod 440 /etc/sudoers.d/luggage-manager

echo "==> Enabling services"
systemctl daemon-reload
systemctl enable luggage-manager
systemctl enable nginx
systemctl restart nginx

echo ""
echo "EC2 setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit $APP_DIR/.env with real database credentials."
echo "  2. Add your GitHub Actions secrets (see README for the list)."
echo "  3. Push to main – the pipeline will deploy automatically."
