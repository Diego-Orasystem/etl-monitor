#!/bin/bash

# Script para configurar el ETL Monitor como servicio systemd

echo "=== Configurando ETL Monitor como servicio ==="
echo ""

# Colores
GREEN='\033[0;32m'
NC='\033[0m'

MONITOR_DIR="/home/fits/etl-monitor"
NODE_PATH=$(which node)

if [ -z "$NODE_PATH" ]; then
    echo "❌ Node.js no está instalado. Ejecuta primero: ./instalar.sh"
    exit 1
fi

# Crear servicio systemd
cat > /etc/systemd/system/etl-monitor.service << EOF
[Unit]
Description=ETL Monitor Web Interface
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$MONITOR_DIR
ExecStart=$NODE_PATH server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=etl-monitor

# Variables de entorno
Environment="NODE_ENV=production"
Environment="PORT=3000"

# Límites de recursos
LimitNOFILE=65536
MemoryMax=512M

[Install]
WantedBy=multi-user.target
EOF

# Recargar systemd
systemctl daemon-reload

# Habilitar servicio
systemctl enable etl-monitor.service

echo -e "${GREEN}✅ Servicio configurado${NC}"
echo ""
echo "Comandos útiles:"
echo "  Iniciar:    systemctl start etl-monitor.service"
echo "  Detener:    systemctl stop etl-monitor.service"
echo "  Estado:     systemctl status etl-monitor.service"
echo "  Logs:       journalctl -u etl-monitor.service -f"
echo ""
read -p "¿Iniciar el servicio ahora? (s/n): " iniciar

if [[ "$iniciar" == "s" || "$iniciar" == "S" ]]; then
    systemctl start etl-monitor.service
    sleep 2
    systemctl status etl-monitor.service --no-pager -l
    echo ""
    echo "✅ Servicio iniciado. Accede a: http://localhost:3000"
fi



