# ETL Services Monitor

Interfaz web para gestionar y monitorear los servicios ETL (etl-upsert y etl-analysis).

## Características

- ✅ Monitoreo en tiempo real del estado de los servicios
- ✅ Control de servicios (Iniciar, Detener, Reiniciar)
- ✅ Habilitar/Deshabilitar inicio automático
- ✅ Visualización de logs en tiempo real
- ✅ Interfaz oscura y moderna
- ✅ Actualización automática cada 5 segundos

## Instalación

### 1. Instalar dependencias

```bash
cd /home/fits/etl-monitor
npm install
```

### 2. Iniciar el servidor

```bash
npm start
```

El servidor se iniciará en `http://0.0.0.0:3000`

### 3. Acceder a la interfaz

Abre tu navegador y ve a:
- `http://localhost:3000` (desde la misma máquina)
- `http://[IP_DE_LA_MAQUINA]:3000` (desde otra máquina en la red)

## Configurar como servicio (Opcional)

Para que el monitor también corra como servicio:

```bash
cat > /etc/systemd/system/etl-monitor.service << 'EOF'
[Unit]
Description=ETL Monitor Web Interface
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/home/fits/etl-monitor
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable etl-monitor.service
systemctl start etl-monitor.service
```

## Uso

1. **Ver estado**: El estado de los servicios se actualiza automáticamente cada 5 segundos
2. **Iniciar/Detener**: Usa los botones para controlar los servicios
3. **Reiniciar**: Reinicia un servicio que esté corriendo
4. **Ver Logs**: Haz clic en "Ver Logs" para ver los últimos 100 logs del servicio
5. **Auto-start**: Habilita o deshabilita el inicio automático del servicio

## Requisitos

- Node.js 18+ instalado
- Permisos para ejecutar comandos `docker` (para controlar servicios en contenedores)

## Variables de entorno (Docker)

El monitor controla servicios ETL ejecutados en Docker mediante `docker compose`:

```bash
ETL_DOCKER_BIN=docker
ETL_DOCKER_COMPOSE_BIN="docker compose"
ETL_DOCKER_COMPOSE_FILE=/home/fits/etl-deploy/docker-compose.yml
ETL_DOCKER_PROJECT_DIR=/home/fits/etl-deploy
ETL_UPSERT_LOG_PATH=/home/fits/etl-data/etl_upsert/etl_upsert.log
ETL_CONSOL_SPEC_PATH=/home/fits/codigo/Desktop/etl_consol/tcode-spec.json
```

## Seguridad

⚠️ **Nota**: Este servidor debe ejecutarse con permisos de root para poder gestionar los servicios systemd. Asegúrate de:

- No exponer este puerto a internet sin protección
- Usar un firewall para restringir el acceso
- Considerar agregar autenticación básica si es necesario

## Solución de Problemas

### El servidor no inicia
- Verifica que Node.js esté instalado: `node --version`
- Verifica que las dependencias estén instaladas: `npm install`

### No se pueden controlar los servicios
- Verifica que el servidor se ejecute con permisos de root
- Verifica que los servicios existan: `systemctl list-units | grep etl`

### Error de conexión
- Verifica que el puerto 3000 no esté en uso: `netstat -tlnp | grep 3000`
- Verifica el firewall si accedes desde otra máquina



