#!/bin/bash

# Script para configurar el ETL Monitor Proxy como servicio systemd
# Este servidor se ejecuta en el servidor principal y se conecta a la VM vía SSH

echo "=== Configurando ETL Monitor Proxy como servicio ==="
echo ""

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

MONITOR_DIR="/home/fits/etl-monitor"
NODE_PATH=$(which node)

if [ -z "$NODE_PATH" ]; then
    echo -e "${RED}❌ Node.js no está instalado${NC}"
    echo "Instalando Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    NODE_PATH=$(which node)
fi

if [ ! -f "$MONITOR_DIR/proxy-server.js" ]; then
    echo -e "${RED}❌ No se encontró proxy-server.js en $MONITOR_DIR${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Node.js encontrado: $NODE_PATH${NC}"
echo ""

# Verificar/instalar dependencias
if [ ! -d "$MONITOR_DIR/node_modules" ]; then
    echo "Instalando dependencias npm..."
    cd "$MONITOR_DIR"
    npm install
fi

# Crear servicio systemd
cat > /tmp/etl-monitor-proxy.service << EOF
[Unit]
Description=ETL Monitor Proxy Server - Acceso desde red externa
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$MONITOR_DIR
ExecStart=$NODE_PATH proxy-server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=etl-monitor-proxy

# Variables de entorno
Environment="NODE_ENV=production"
Environment="PORT=3000"

# Límites de recursos
LimitNOFILE=65536
MemoryMax=512M

[Install]
WantedBy=multi-user.target
EOF

# Copiar servicio
sudo cp /tmp/etl-monitor-proxy.service /etc/systemd/system/

# Recargar systemd
sudo systemctl daemon-reload

# Habilitar servicio
sudo systemctl enable etl-monitor-proxy.service

echo -e "${GREEN}✅ Servicio configurado${NC}"
echo ""

# Configurar SSH sin contraseña (opcional)
echo -e "${YELLOW}¿Configurar SSH sin contraseña para root@192.168.122.222? (recomendado)${NC}"
read -p "Esto permitirá que el proxy se conecte sin pedir contraseña (s/n): " config_ssh

if [[ "$config_ssh" == "s" || "$config_ssh" == "S" ]]; then
    if [ ! -f ~/.ssh/id_rsa.pub ]; then
        echo "Generando clave SSH..."
        ssh-keygen -t rsa -f ~/.ssh/id_rsa -N ""
    fi
    
    echo "Copiando clave pública a la VM..."
    ssh-copy-id root@192.168.122.222
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ SSH configurado sin contraseña${NC}"
    else
        echo -e "${YELLOW}⚠️  No se pudo configurar SSH automáticamente${NC}"
        echo "Puedes hacerlo manualmente más tarde"
    fi
fi

echo ""
echo "Comandos útiles:"
echo "  Iniciar:    sudo systemctl start etl-monitor-proxy.service"
echo "  Detener:    sudo systemctl stop etl-monitor-proxy.service"
echo "  Estado:     sudo systemctl status etl-monitor-proxy.service"
echo "  Logs:       sudo journalctl -u etl-monitor-proxy.service -f"
echo ""
read -p "¿Iniciar el servicio ahora? (s/n): " iniciar

if [[ "$iniciar" == "s" || "$iniciar" == "S" ]]; then
    sudo systemctl start etl-monitor-proxy.service
    sleep 2
    sudo systemctl status etl-monitor-proxy.service --no-pager -l
    
    # Obtener IP del servidor
    SERVER_IP=$(hostname -I | awk '{print $1}')
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✅ SERVICIO INICIADO                                         ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Accede a la interfaz desde tu PC:"
    echo -e "${GREEN}  http://$SERVER_IP:3000${NC}"
    echo ""
fi



