#!/bin/bash
# =============================================================================
# AI Sales Operator — VPS Deploy Script
# Ubuntu 22.04 / 24.04 | Zomro Exclusive Intel
#
# Запуск (от root):
#   curl -fsSL https://raw.githubusercontent.com/YOUR/REPO/main/scripts/deploy-vps.sh | bash
# Или после git clone:
#   chmod +x scripts/deploy-vps.sh && sudo bash scripts/deploy-vps.sh
# =============================================================================

set -euo pipefail

# --------------------------------------------------------------------------
# Цвета для вывода
# --------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERR]${NC}  $1"; exit 1; }

# --------------------------------------------------------------------------
# Конфигурация — измени под свой проект
# --------------------------------------------------------------------------
APP_USER="aisales"
APP_DIR="/home/${APP_USER}/app"
LOGS_DIR="/home/${APP_USER}/logs"
DB_NAME="aisales_db"
DB_USER="aisales_user"
DB_PASS=""           # будет сгенерирован автоматически ниже
DOMAIN=""            # например: myapp.example.com (пусто = работает по IP)
NODE_VERSION="20"
PYTHON_VERSION="3.11"
REDIS_PORT="6379"
APP_PORT="5000"
PYTHON_SERVICE_PORT="8200"

# --------------------------------------------------------------------------
# Проверки
# --------------------------------------------------------------------------
[[ $EUID -ne 0 ]] && error "Запусти скрипт от root: sudo bash deploy-vps.sh"
[[ "$(lsb_release -si)" != "Ubuntu" ]] && error "Поддерживается только Ubuntu 22.04/24.04"

info "=== AI Sales Operator — Деплой на VPS ==="
info "Пользователь приложения: ${APP_USER}"
info "Директория:              ${APP_DIR}"

# --------------------------------------------------------------------------
# 1. Обновление системы
# --------------------------------------------------------------------------
info "Обновляем систему..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
    curl wget git unzip build-essential \
    software-properties-common apt-transport-https \
    ca-certificates gnupg lsb-release \
    nginx certbot python3-certbot-nginx \
    ufw fail2ban htop

success "Система обновлена"

# --------------------------------------------------------------------------
# 2. Создание пользователя приложения
# --------------------------------------------------------------------------
if ! id "${APP_USER}" &>/dev/null; then
    info "Создаём пользователя ${APP_USER}..."
    useradd -m -s /bin/bash "${APP_USER}"
    success "Пользователь ${APP_USER} создан"
else
    info "Пользователь ${APP_USER} уже существует"
fi

# --------------------------------------------------------------------------
# 3. Node.js 20
# --------------------------------------------------------------------------
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" != "${NODE_VERSION}" ]]; then
    info "Устанавливаем Node.js ${NODE_VERSION}..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y -qq nodejs
    success "Node.js $(node -v) установлен"
else
    success "Node.js $(node -v) уже установлен"
fi

# --------------------------------------------------------------------------
# 4. Python 3.11
# --------------------------------------------------------------------------
if ! command -v python3.11 &>/dev/null; then
    info "Устанавливаем Python ${PYTHON_VERSION}..."
    add-apt-repository -y ppa:deadsnakes/ppa
    apt-get update -qq
    apt-get install -y -qq python3.11 python3.11-venv python3.11-dev python3-pip
    success "Python $(python3.11 --version) установлен"
else
    success "Python $(python3.11 --version) уже установлен"
fi

# --------------------------------------------------------------------------
# 5. PostgreSQL 16
# --------------------------------------------------------------------------
if ! command -v psql &>/dev/null; then
    info "Устанавливаем PostgreSQL 16..."
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
        > /etc/apt/sources.list.d/postgresql.list
    apt-get update -qq
    apt-get install -y -qq postgresql-16 postgresql-client-16
    systemctl enable postgresql
    systemctl start postgresql
    success "PostgreSQL 16 установлен"
else
    success "PostgreSQL уже установлен"
fi

# Создаём базу и пользователя
if [[ -z "${DB_PASS}" ]]; then
    DB_PASS=$(openssl rand -base64 24 | tr -d '+/=' | head -c 32)
fi

info "Настраиваем PostgreSQL..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_user WHERE usename='${DB_USER}'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
success "PostgreSQL: база ${DB_NAME} готова"

# --------------------------------------------------------------------------
# 6. Redis 7
# --------------------------------------------------------------------------
if ! command -v redis-server &>/dev/null; then
    info "Устанавливаем Redis 7..."
    curl -fsSL https://packages.redis.io/gpg | gpg --dearmor -o /usr/share/keyrings/redis.gpg
    echo "deb [signed-by=/usr/share/keyrings/redis.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" \
        > /etc/apt/sources.list.d/redis.list
    apt-get update -qq
    apt-get install -y -qq redis-server
    systemctl enable redis-server
    systemctl start redis-server
    success "Redis $(redis-server --version | cut -d' ' -f3) установлен"
else
    success "Redis уже установлен"
fi

# --------------------------------------------------------------------------
# 7. PM2
# --------------------------------------------------------------------------
if ! command -v pm2 &>/dev/null; then
    info "Устанавливаем PM2..."
    npm install -g pm2
    success "PM2 установлен"
else
    success "PM2 $(pm2 --version) уже установлен"
fi

# --------------------------------------------------------------------------
# 8. Директории
# --------------------------------------------------------------------------
info "Создаём директории..."
mkdir -p "${APP_DIR}" "${LOGS_DIR}"
chown -R "${APP_USER}:${APP_USER}" "/home/${APP_USER}"
success "Директории готовы"

# --------------------------------------------------------------------------
# 9. Копирование кода
# --------------------------------------------------------------------------
# Если скрипт запускается из директории проекта — копируем отсюда
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

if [[ -f "${PROJECT_ROOT}/package.json" ]]; then
    info "Копируем проект из ${PROJECT_ROOT} → ${APP_DIR}..."
    rsync -a --delete \
        --exclude='node_modules' \
        --exclude='.git' \
        --exclude='dist' \
        --exclude='*.log' \
        --exclude='.env' \
        "${PROJECT_ROOT}/" "${APP_DIR}/"
    success "Код скопирован"
else
    warn "package.json не найден рядом со скриптом."
    warn "Скопируй код вручную в ${APP_DIR} и перезапусти:"
    warn "  sudo bash ${APP_DIR}/scripts/deploy-vps.sh"
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

# --------------------------------------------------------------------------
# 10. .env файл
# --------------------------------------------------------------------------
ENV_FILE="${APP_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
    info "Создаём .env из шаблона..."
    cat > "${ENV_FILE}" << EOF
# === AI Sales Operator — Production .env ===
# Сгенерировано deploy-vps.sh $(date)
# ЗАПОЛНИ ПУСТЫЕ ЗНАЧЕНИЯ!

NODE_ENV=production
PORT=${APP_PORT}
APP_URL=https://${DOMAIN:-your-domain.com}
TRUST_PROXY=true

# Database (уже настроено)
DATABASE_URL=${DATABASE_URL}

# Redis (уже настроено)
REDIS_URL=redis://localhost:${REDIS_PORT}

# Python Podzamenu Service (уже настроено)
PODZAMENU_LOOKUP_SERVICE_URL=http://localhost:${PYTHON_SERVICE_PORT}

# ============ ЗАПОЛНИ ОБЯЗАТЕЛЬНО ============

# OpenAI
AI_INTEGRATIONS_OPENAI_API_KEY=sk-...

# Сгенерируй: openssl rand -hex 32
SESSION_SECRET=$(openssl rand -hex 32)

# Сгенерируй: openssl rand -base64 32
INTEGRATION_SECRETS_MASTER_KEY=$(openssl rand -base64 32)

# Telegram Personal (my.telegram.org → API development tools)
# TELEGRAM_API_ID=
# TELEGRAM_API_HASH=

# Telegram Bot
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_WEBHOOK_SECRET=

# WhatsApp Business API
# WHATSAPP_API_TOKEN=
# WHATSAPP_PHONE_ID=

# Price sources
# AVITO_ENABLED=true
# DROM_ENABLED=true
# SERP_API_KEY=

# Billing
# CRYPTOBOT_API_TOKEN=

# Platform owner (первичная учётная запись)
OWNER_EMAIL=admin@example.com
OWNER_PASSWORD=change_me_immediately

# Feature flags
FEATURE_AI_SUGGESTIONS_ENABLED=true
FEATURE_RAG_ENABLED=true
EOF
    chown "${APP_USER}:${APP_USER}" "${ENV_FILE}"
    chmod 600 "${ENV_FILE}"
    warn "Создан ${ENV_FILE} — ЗАПОЛНИ пустые значения перед запуском!"
else
    info ".env уже существует, пропускаем"
fi

# --------------------------------------------------------------------------
# 11. npm install + сборка
# --------------------------------------------------------------------------
info "Устанавливаем npm зависимости..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npm ci --prefer-offline 2>&1"
success "npm зависимости установлены"

info "Собираем TypeScript / Vite..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npm run build 2>&1"
success "Сборка завершена"

# --------------------------------------------------------------------------
# 12. Python venv + зависимости + Playwright
# --------------------------------------------------------------------------
VENV_DIR="${APP_DIR}/.venv"
info "Создаём Python venv..."
sudo -u "${APP_USER}" python3.11 -m venv "${VENV_DIR}"

info "Устанавливаем Python зависимости..."
sudo -u "${APP_USER}" bash -c "${VENV_DIR}/bin/pip install -q --upgrade pip"
sudo -u "${APP_USER}" bash -c "${VENV_DIR}/bin/pip install -q \
    fastapi uvicorn playwright pydantic \
    aiohttp httpx requests pillow qrcode maxapi-python"

info "Устанавливаем Playwright Chromium (может занять 2-3 минуты)..."
sudo -u "${APP_USER}" bash -c "PLAYWRIGHT_BROWSERS_PATH=${APP_DIR}/.playwright ${VENV_DIR}/bin/playwright install chromium --with-deps 2>&1" || \
    warn "Playwright install завершился с предупреждением, проверь вручную"
success "Python сервис готов"

# --------------------------------------------------------------------------
# 13. Обновляем ecosystem.config.cjs для venv-путей
# --------------------------------------------------------------------------
info "Обновляем PM2 ecosystem для VPS..."
cat > "${APP_DIR}/ecosystem.config.cjs" << 'ECOSYSTEM'
const fs   = require('fs');
const path = require('path');

const envPath  = path.join(__dirname, '.env');
const envVars  = {};

if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
}

const LOGS = path.join(__dirname, '../logs');

module.exports = {
  apps: [
    {
      name: 'aisales',
      script: 'dist/index.cjs',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production', PORT: 5000, ...envVars },
      error_file: path.join(LOGS, 'aisales-error.log'),
      out_file:   path.join(LOGS, 'aisales-out.log'),
      log_file:   path.join(LOGS, 'aisales-combined.log'),
      time: true
    },
    {
      name: 'worker-price-lookup',
      script: 'npm',
      args: 'run worker:price-lookup',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', ...envVars },
      error_file: path.join(LOGS, 'price-worker-error.log'),
      out_file:   path.join(LOGS, 'price-worker-out.log'),
      time: true
    },
    {
      name: 'podzamenu-service',
      script: path.join(__dirname, 'podzamenu_lookup_service.py'),
      interpreter: path.join(__dirname, '.venv/bin/python3'),
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        PORT: '8200',
        PLAYWRIGHT_BROWSERS_PATH: path.join(__dirname, '.playwright'),
        ...envVars
      },
      error_file: path.join(LOGS, 'podzamenu-error.log'),
      out_file:   path.join(LOGS, 'podzamenu-out.log'),
      time: true
    }
  ]
};
ECOSYSTEM

chown "${APP_USER}:${APP_USER}" "${APP_DIR}/ecosystem.config.cjs"
success "ecosystem.config.cjs обновлён"

# --------------------------------------------------------------------------
# 14. Nginx
# --------------------------------------------------------------------------
info "Настраиваем Nginx..."
NGINX_CONF="/etc/nginx/sites-available/aisales"

cat > "${NGINX_CONF}" << NGINX
server {
    listen 80;
    server_name ${DOMAIN:-_};

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Logs
    access_log /var/log/nginx/aisales-access.log;
    error_log  /var/log/nginx/aisales-error.log;

    # WebSocket + HTTP proxy
    location / {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 50M;
    }
}
NGINX

ln -sf "${NGINX_CONF}" /etc/nginx/sites-enabled/aisales
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
success "Nginx настроен"

# --------------------------------------------------------------------------
# 15. Firewall
# --------------------------------------------------------------------------
info "Настраиваем UFW firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
success "Firewall настроен (ssh + 80 + 443)"

# --------------------------------------------------------------------------
# 16. PM2 — первый запуск
# --------------------------------------------------------------------------
info "Запускаем приложение через PM2..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && pm2 start ecosystem.config.cjs"
sudo -u "${APP_USER}" bash -c "pm2 save"

# Автозапуск PM2 при перезагрузке сервера
PM2_STARTUP=$(sudo -u "${APP_USER}" pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}" | grep "sudo env")
if [[ -n "${PM2_STARTUP}" ]]; then
    eval "${PM2_STARTUP}"
fi
success "PM2 запущен и добавлен в автозапуск"

# --------------------------------------------------------------------------
# 17. Миграции БД
# --------------------------------------------------------------------------
info "Запускаем миграции базы данных..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npx drizzle-kit push --force" || \
    warn "Миграции завершились с ошибкой — проверь .env DATABASE_URL и логи"
success "Миграции выполнены"

# --------------------------------------------------------------------------
# 18. SSL (если задан домен)
# --------------------------------------------------------------------------
if [[ -n "${DOMAIN}" ]]; then
    info "Получаем SSL сертификат для ${DOMAIN}..."
    certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "admin@${DOMAIN}" || \
        warn "certbot не смог получить сертификат — проверь DNS и попробуй вручную: certbot --nginx -d ${DOMAIN}"
fi

# --------------------------------------------------------------------------
# Итоговая сводка
# --------------------------------------------------------------------------
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  ДЕПЛОЙ ЗАВЕРШЁН${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "  Директория приложения: ${BLUE}${APP_DIR}${NC}"
echo -e "  Логи:                  ${BLUE}${LOGS_DIR}${NC}"
echo -e "  .env файл:             ${BLUE}${ENV_FILE}${NC}"
echo ""
echo -e "  База данных:"
echo -e "    DATABASE_URL = ${BLUE}${DATABASE_URL}${NC}"
echo ""
echo -e "  Полезные команды:"
echo -e "    ${YELLOW}pm2 status${NC}                   — статус всех процессов"
echo -e "    ${YELLOW}pm2 logs aisales${NC}             — логи основного приложения"
echo -e "    ${YELLOW}pm2 logs worker-price-lookup${NC} — логи воркера цен"
echo -e "    ${YELLOW}pm2 logs podzamenu-service${NC}   — логи Python сервиса"
echo -e "    ${YELLOW}pm2 restart all${NC}              — перезапустить всё"
echo -e "    ${YELLOW}pm2 monit${NC}                    — мониторинг RAM/CPU в реальном времени"
echo ""
echo -e "  ${RED}ВАЖНО: заполни оставшиеся переменные в ${ENV_FILE}${NC}"
echo -e "  ${RED}Затем выполни: pm2 restart all${NC}"
echo ""
if [[ -n "${DOMAIN}" ]]; then
    echo -e "  Приложение доступно по: ${BLUE}https://${DOMAIN}${NC}"
else
    echo -e "  Приложение доступно по: ${BLUE}http://$(curl -s ifconfig.me)${NC}"
fi
echo ""
