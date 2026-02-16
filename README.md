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

### Opción A: Docker (recomendado)

```bash
cd /home/fits/etl-monitor
docker compose up -d --build
```

El servidor se iniciará en `http://0.0.0.0:3000`.

> Nota: el contenedor necesita acceso al Docker del host para controlar los ETL. El `docker-compose.yml` ya monta `/var/run/docker.sock` y las rutas requeridas:
> - `/home/fits/etl-deploy`
> - `/home/fits/codigo/Desktop`
> - `/home/fits/etl-data`
> - `./data`

### Opción B: Local (Node.js)

#### 1. Instalar dependencias

```bash
cd /home/fits/etl-monitor
npm install
```

#### 2. Iniciar el servidor

```bash
npm start
```

El servidor se iniciará en `http://0.0.0.0:3000`.

#### 3. Acceder a la interfaz

Abre tu navegador y ve a:
- `http://localhost:3000` (desde la misma máquina)
- `http://[IP_DE_LA_MAQUINA]:3000` (desde otra máquina en la red)

## Configurar como servicio (Opcional, si lo ejecutas en host)

Para que el monitor corra como servicio en el host:

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

- Docker Engine + Docker Compose v2 (si usas Docker)
- Node.js 18+ instalado (si lo ejecutas en host)
- Permisos para ejecutar comandos `docker` (o acceso al socket)

## Variables de entorno (Docker)

El monitor controla servicios ETL ejecutados en Docker mediante `docker compose`:

```bash
PORT=3000
ETL_DOCKER_BIN=docker
ETL_DOCKER_COMPOSE_BIN="docker compose"
ETL_DOCKER_COMPOSE_FILE=/home/fits/etl-deploy/docker-compose.yml
ETL_DOCKER_PROJECT_DIR=/home/fits/etl-deploy
ETL_UPSERT_LOG_PATH=/home/fits/etl-data/etl_upsert/etl_upsert.log
ETL_CONSOL_SPEC_PATH=/home/fits/codigo/Desktop/etl_consol/tcode-spec.json
```

## Seguridad

⚠️ **Nota**: Para controlar Docker, el monitor necesita acceso al socket `/var/run/docker.sock` (equivalente a permisos elevados en el host). Asegúrate de:

- No exponer este puerto a internet sin protección
- Usar un firewall para restringir el acceso
- Considerar agregar autenticación básica si es necesario

## Solución de Problemas

### El servidor no inicia
- Verifica que Node.js esté instalado: `node --version`
- Verifica que las dependencias estén instaladas: `npm install`

### No se pueden controlar los servicios
- Verifica acceso a Docker (socket montado en contenedor o permisos locales)
- Verifica que exista el archivo `ETL_DOCKER_COMPOSE_FILE`
- Verifica que `docker compose` funcione en el host

### Error de conexión
- Verifica que el puerto 3000 no esté en uso: `netstat -tlnp | grep 3000`
- Verifica el firewall si accedes desde otra máquina



