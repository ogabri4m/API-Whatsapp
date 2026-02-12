#!/bin/bash
# ============================================
# Setup automatico do WhatsApp Anti-Ban
# Gera .env com API Key real
# ============================================

ENV_FILE=".env"

if [ -f "$ENV_FILE" ]; then
  echo "Arquivo .env ja existe. Deseja sobrescrever? (s/N)"
  read -r resp
  if [ "$resp" != "s" ] && [ "$resp" != "S" ]; then
    echo "Setup cancelado."
    exit 0
  fi
fi

# Gera API Key aleatoria
API_KEY=$(openssl rand -hex 16 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(16))" 2>/dev/null || head -c 32 /dev/urandom | xxd -p | head -c 32)

echo "Gerando .env com API Key: $API_KEY"

cat > "$ENV_FILE" << EOF
# ============================================
# WhatsApp Anti-Ban Middleware - Configuration
# Gerado automaticamente por setup.sh
# ============================================

# --- Evolution API ---
EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_API_KEY=$API_KEY

# --- Redis ---
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

# --- Middleware Server ---
MIDDLEWARE_PORT=3100
MIDDLEWARE_API_KEY=

# --- Anti-Ban Config ---
ANTIBAN_DELAY_MIN=3000
ANTIBAN_DELAY_MAX=12000
ANTIBAN_BATCH_DELAY_MIN=30000
ANTIBAN_BATCH_DELAY_MAX=120000
ANTIBAN_BATCH_SIZE=10
ANTIBAN_WARMUP_HOURS=48
ANTIBAN_WARMUP_DAILY_LIMIT=20
ANTIBAN_DAILY_LIMIT=200
ANTIBAN_SEND_HOUR_START=8
ANTIBAN_SEND_HOUR_END=21

# --- N8N Webhook ---
N8N_WEBHOOK_URL=http://n8n:5678/webhook/whatsapp
N8N_WEBHOOK_SECRET=
EOF

echo ""
echo "==================================="
echo " .env criado com sucesso!"
echo "==================================="
echo ""
echo " API Key da Evolution: $API_KEY"
echo ""
echo " Use esta chave no Evolution Manager"
echo " para autenticar (porta 8080)."
echo ""
echo " Agora rode:"
echo "   docker-compose down"
echo "   docker-compose build --no-cache anti-ban-middleware"
echo "   docker-compose up -d"
echo ""
