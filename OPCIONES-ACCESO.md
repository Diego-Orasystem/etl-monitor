# Opciones para Acceder a ETL Monitor desde tu PC

## Problema
Tu PC accede al servidor principal, pero la máquina virtual (debian-vm06) está en una red interna (192.168.122.222) que no es accesible directamente desde tu PC.

## Soluciones

### Opción 1: Servidor Proxy en el Servidor Principal (Recomendado) ⭐

Ejecuta el servidor proxy en el servidor principal que se conecta a la VM vía SSH.

**1. Instalar dependencias en el servidor principal:**
```bash
cd /home/fits/etl-monitor
npm install
```

**2. Usar el servidor proxy:**
```bash
# En lugar de server.js, usar proxy-server.js
node proxy-server.js
```

**3. Acceder desde tu PC:**
```
http://[IP_DEL_SERVIDOR_PRINCIPAL]:3000
```

El servidor proxy ejecutará comandos SSH en la VM para gestionar los servicios.

### Opción 2: SSH Port Forwarding (Temporal)

Desde tu PC, crea un túnel SSH:

```bash
ssh -L 3000:192.168.122.222:3000 usuario@[IP_SERVIDOR_PRINCIPAL]
```

Luego accede desde tu PC a: `http://localhost:3000`

### Opción 3: Configurar Nginx como Proxy Reverso

**1. Instalar nginx en el servidor principal:**
```bash
sudo apt-get install nginx
```

**2. Configurar proxy:**
```bash
sudo nano /etc/nginx/sites-available/etl-monitor
```

Agregar:
```nginx
server {
    listen 80;
    server_name [IP_O_DOMINIO];

    location / {
        proxy_pass http://192.168.122.222:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**3. Habilitar y reiniciar:**
```bash
sudo ln -s /etc/nginx/sites-available/etl-monitor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

**4. Acceder desde tu PC:**
```
http://[IP_SERVIDOR_PRINCIPAL]
```

### Opción 4: Configurar como Servicio en el Servidor Principal

**1. Crear servicio systemd para el proxy:**
```bash
cat > /etc/systemd/system/etl-monitor-proxy.service << 'EOF'
[Unit]
Description=ETL Monitor Proxy Server
After=network.target

[Service]
Type=simple
User=fits
WorkingDirectory=/home/fits/etl-monitor
ExecStart=/usr/bin/node proxy-server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable etl-monitor-proxy.service
systemctl start etl-monitor-proxy.service
```

**2. Acceder desde tu PC:**
```
http://[IP_SERVIDOR_PRINCIPAL]:3000
```

## Recomendación

Usa la **Opción 1** (servidor proxy) porque:
- ✅ No requiere configuración adicional de red
- ✅ Funciona directamente desde el servidor principal
- ✅ Puede ejecutarse como servicio
- ✅ Accesible desde cualquier PC en la red del servidor

## Configuración de SSH sin contraseña (Opcional)

Para que el proxy funcione sin pedir contraseña cada vez:

```bash
# En el servidor principal
ssh-keygen -t rsa
ssh-copy-id root@192.168.122.222
```

Esto permitirá que el servidor proxy se conecte a la VM sin contraseña.



