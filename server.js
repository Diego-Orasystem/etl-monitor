const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const tableMonitor = require('./tableMonitor');

const execAsync = promisify(exec);
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = 3000;

const DOCKER_BIN = process.env.ETL_DOCKER_BIN || 'docker';
const DOCKER_COMPOSE_BIN = process.env.ETL_DOCKER_COMPOSE_BIN || 'docker compose';
const DOCKER_COMPOSE_FILE = process.env.ETL_DOCKER_COMPOSE_FILE || '/home/fits/etl-deploy/docker-compose.yml';
const DOCKER_COMPOSE_PROJECT_DIR = process.env.ETL_DOCKER_PROJECT_DIR || path.dirname(DOCKER_COMPOSE_FILE);
const ETL_UPSERT_LOG_PATH = process.env.ETL_UPSERT_LOG_PATH || '/home/fits/etl-data/etl_upsert/etl_upsert.log';
const ETL_CONSOL_SPEC_PATH = process.env.ETL_CONSOL_SPEC_PATH || '/home/fits/codigo/Desktop/etl_consol/tcode-spec.json';

// Servicios a gestionar
const SERVICES = {
    'etl-analysis': {
        name: 'ETL Analysis',
        description: 'Análisis de archivos Excel',
        composeService: 'etl_analysis',
        container: 'etl_analysis'
    },
    'etl-upsert': {
        name: 'ETL Upsert',
        description: 'Procesamiento automático de archivos Excel desde SFTP',
        composeService: 'etl_upsert',
        container: 'etl_upsert'
    },
    'etl-consol': {
        name: 'ETL Consolidation',
        description: 'Consolidación de tablas de LEK-RAW a LEK-JOINED',
        composeService: 'etl_consol',
        container: 'etl_consol'
    },
    'trigger-manager': {
        name: 'Gestor de Triggers y APIs',
        description: 'Mantenedor de triggers y APIs asociadas',
        composeService: null,
        container: null // No es un servicio docker
    }
};

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function runCommand(command, options = {}) {
    try {
        const { stdout, stderr } = await execAsync(command, {
            maxBuffer: 10 * 1024 * 1024,
            ...options
        });
        return { success: true, output: stdout, error: stderr };
    } catch (error) {
        return { success: false, output: error.stdout || '', error: error.stderr || error.message };
    }
}

async function dockerComposeCommand(args) {
    const command = `${DOCKER_COMPOSE_BIN} -f "${DOCKER_COMPOSE_FILE}" ${args}`;
    return runCommand(command, { cwd: DOCKER_COMPOSE_PROJECT_DIR });
}

async function getServiceStatus(service) {
    if (!service.container) {
        return { active: true, enabled: true };
    }

    try {
        const result = await runCommand(`${DOCKER_BIN} inspect ${service.container}`);
        if (!result.success) {
            throw new Error(result.error || 'No se pudo inspeccionar el contenedor');
        }
        const info = JSON.parse(result.output)[0] || {};
        const isActive = Boolean(info?.State?.Running);
        const restartPolicy = info?.HostConfig?.RestartPolicy?.Name || 'no';
        const isEnabled = restartPolicy !== 'no';

        return { active: isActive, enabled: isEnabled };
    } catch (error) {
        return { active: false, enabled: false, error: error.error || error.message };
    }
}

// API Routes

// Obtener estado de todos los servicios
app.get('/api/services/status', async (req, res) => {
    try {
        const statuses = {};
        for (const [key, service] of Object.entries(SERVICES)) {
            const status = await getServiceStatus(service);
            statuses[key] = {
                ...service,
                ...status
            };
        }
        res.json({ success: true, services: statuses });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener estado de un servicio específico
app.get('/api/services/:serviceId/status', async (req, res) => {
    const { serviceId } = req.params;
    const service = SERVICES[serviceId];
    
    if (!service) {
        return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
    }
    
    try {
        const status = await getServiceStatus(service);
        res.json({ success: true, service: { ...service, ...status } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Controlar servicio (start, stop, restart)
app.post('/api/services/:serviceId/:action', async (req, res) => {
    const { serviceId, action } = req.params;
    const service = SERVICES[serviceId];
    
    if (!service) {
        return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
    }
    
    // Si no es un servicio docker, no se puede controlar
    if (!service.composeService) {
        return res.status(400).json({ success: false, error: 'Este servicio no se puede controlar mediante docker' });
    }
    
    const validActions = ['start', 'stop', 'restart'];
    if (!validActions.includes(action)) {
        return res.status(400).json({ success: false, error: 'Acción no válida' });
    }
    
    try {
        let result;
        if (action === 'start') {
            result = await dockerComposeCommand(`up -d ${service.composeService}`);
        } else if (action === 'stop') {
            result = await dockerComposeCommand(`stop ${service.composeService}`);
        } else {
            result = await dockerComposeCommand(`restart ${service.composeService}`);
        }
        if (result.success) {
            // Esperar un momento y obtener el nuevo estado
            await new Promise(resolve => setTimeout(resolve, 1000));
            const status = await getServiceStatus(service);
            res.json({ 
                success: true, 
                message: `Servicio ${action} ejecutado correctamente`,
                status 
            });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener logs de un servicio
app.get('/api/services/:serviceId/logs', async (req, res) => {
    const { serviceId } = req.params;
    const { lines = 100 } = req.query;
    const service = SERVICES[serviceId];
    
    if (!service) {
        return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
    }
    
    // Si no es un servicio docker, no hay logs disponibles
    if (!service.container) {
        return res.json({ success: true, logs: 'Este servicio no tiene logs disponibles' });
    }
    
    try {
        // Intentar leer el archivo de log estructurado primero (para etl-upsert)
        const fs = require('fs');
        const logFile = ETL_UPSERT_LOG_PATH;
        
        if (serviceId === 'etl-upsert' && fs.existsSync(logFile)) {
            // Leer el archivo de log estructurado
            const logContent = fs.readFileSync(logFile, 'utf8');
            const logLines = logContent.split('\n');
            const lastLines = logLines.slice(-parseInt(lines)).join('\n');
            res.json({ success: true, logs: lastLines || 'No hay logs disponibles' });
        } else {
            const logResult = await runCommand(`${DOCKER_BIN} logs --tail ${parseInt(lines)} ${service.container}`);
            if (!logResult.success) {
                return res.status(500).json({ success: false, error: logResult.error });
            }
            res.json({ success: true, logs: logResult.output });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Habilitar/deshabilitar inicio automático
app.post('/api/services/:serviceId/enable', async (req, res) => {
    const { serviceId } = req.params;
    const { enabled } = req.body;
    const service = SERVICES[serviceId];
    
    if (!service) {
        return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
    }
    
    // Si no es un servicio docker, no se puede habilitar/deshabilitar
    if (!service.container) {
        return res.status(400).json({ success: false, error: 'Este servicio no se puede habilitar/deshabilitar mediante docker' });
    }
    
    try {
        const restartPolicy = enabled ? 'unless-stopped' : 'no';
        const result = await runCommand(`${DOCKER_BIN} update --restart ${restartPolicy} ${service.container}`);
        
        if (result.success) {
            const status = await getServiceStatus(service);
            res.json({ 
                success: true, 
                message: `Servicio ${enabled ? 'habilitado' : 'deshabilitado'} correctamente`,
                status 
            });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// API para CRUD de TCODE Spec (etl_consol)
// ═══════════════════════════════════════════════════════════════════════════
const TCODE_SPEC_PATH = ETL_CONSOL_SPEC_PATH;

// GET: Obtener el spec completo (solo habilitados, formato para procesamiento)
app.get('/api/etl-consol/spec', (req, res) => {
    try {
        if (!fs.existsSync(TCODE_SPEC_PATH)) {
            return res.json({ success: true, spec: {} });
        }
        const content = fs.readFileSync(TCODE_SPEC_PATH, 'utf8');
        const rawSpec = JSON.parse(content);
        
        // Filtrar solo habilitados y convertir a formato de procesamiento
        const spec = {};
        for (const [tcode, config] of Object.entries(rawSpec)) {
            if (typeof config === 'object' && config !== null && !Array.isArray(config)) {
                if (config.enabled === true) {
                    if (config.keyColumns || config.mergeColumns) {
                        spec[tcode] = {
                            keyColumns: config.keyColumns || [],
                            mergeColumns: config.mergeColumns || []
                        };
                    } else if (config.columns) {
                        spec[tcode] = config.columns;
                    }
                }
            } else if (Array.isArray(config)) {
                // Formato antiguo - asumir habilitado
                spec[tcode] = config;
            } else {
                // Formato antiguo - asumir habilitado
                spec[tcode] = config;
            }
        }
        
        res.json({ success: true, spec });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET: Obtener el spec completo con información de enabled (para interfaz)
app.get('/api/etl-consol/spec-full', (req, res) => {
    try {
        if (!fs.existsSync(TCODE_SPEC_PATH)) {
            return res.json({ success: true, spec: {} });
        }
        const content = fs.readFileSync(TCODE_SPEC_PATH, 'utf8');
        const rawSpec = JSON.parse(content);
        
        // Normalizar formato: convertir arrays a objetos con enabled
        const spec = {};
        for (const [tcode, config] of Object.entries(rawSpec)) {
            if (Array.isArray(config)) {
                // Formato antiguo: array directo = habilitado por defecto (comportamiento original)
                spec[tcode] = {
                    enabled: true,
                    columns: config
                };
            } else if (typeof config === 'object' && config !== null) {
                // Formato nuevo: asegurar que tenga enabled (default: false si no está definido)
                spec[tcode] = {
                    enabled: config.enabled !== undefined ? config.enabled : false,
                    ...config
                };
            }
        }
        
        res.json({ success: true, spec });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT: Actualizar el spec completo
app.put('/api/etl-consol/spec', (req, res) => {
    try {
        const { spec } = req.body;
        if (!spec || typeof spec !== 'object') {
            return res.status(400).json({ success: false, error: 'spec debe ser un objeto' });
        }
        
        // Validar formato básico
        for (const [tcode, value] of Object.entries(spec)) {
            if (Array.isArray(value)) {
                // Formato simple: array de strings (formato antiguo, se considera habilitado)
                if (!value.every(v => typeof v === 'string')) {
                    return res.status(400).json({ 
                        success: false, 
                        error: `TCODE ${tcode}: array debe contener solo strings` 
                    });
                }
            } else if (typeof value === 'object' && value !== null) {
                // Formato complejo: objeto con keyColumns y/o mergeColumns o columns
                if (value.keyColumns && !Array.isArray(value.keyColumns)) {
                    return res.status(400).json({ 
                        success: false, 
                        error: `TCODE ${tcode}: keyColumns debe ser un array` 
                    });
                }
                if (value.mergeColumns && !Array.isArray(value.mergeColumns)) {
                    return res.status(400).json({ 
                        success: false, 
                        error: `TCODE ${tcode}: mergeColumns debe ser un array` 
                    });
                }
                if (value.columns && !Array.isArray(value.columns)) {
                    return res.status(400).json({ 
                        success: false, 
                        error: `TCODE ${tcode}: columns debe ser un array` 
                    });
                }
            } else {
                return res.status(400).json({ 
                    success: false, 
                    error: `TCODE ${tcode}: valor debe ser array u objeto con keyColumns/mergeColumns/columns` 
                });
            }
        }
        
        // Escribir archivo con formato legible (2 espacios de indentación)
        fs.writeFileSync(TCODE_SPEC_PATH, JSON.stringify(spec, null, 2), 'utf8');
        res.json({ success: true, message: 'Especificación actualizada correctamente' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET: Obtener un TCODE específico
app.get('/api/etl-consol/spec/:tcode', (req, res) => {
    try {
        if (!fs.existsSync(TCODE_SPEC_PATH)) {
            return res.status(404).json({ success: false, error: 'TCODE no encontrado' });
        }
        const content = fs.readFileSync(TCODE_SPEC_PATH, 'utf8');
        const spec = JSON.parse(content);
        const { tcode } = req.params;
        
        if (!spec[tcode]) {
            return res.status(404).json({ success: false, error: 'TCODE no encontrado' });
        }
        
        res.json({ success: true, tcode, spec: spec[tcode] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT: Actualizar un TCODE específico
app.put('/api/etl-consol/spec/:tcode', (req, res) => {
    try {
        const { tcode } = req.params;
        const { spec: tcodeSpec } = req.body;
        
        if (!tcodeSpec) {
            return res.status(400).json({ success: false, error: 'Se requiere especificación del TCODE' });
        }
        
        // Validar formato
        if (Array.isArray(tcodeSpec)) {
            if (!tcodeSpec.every(v => typeof v === 'string')) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Array debe contener solo strings' 
                });
            }
        } else if (typeof tcodeSpec === 'object' && tcodeSpec !== null) {
            if (tcodeSpec.keyColumns && !Array.isArray(tcodeSpec.keyColumns)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'keyColumns debe ser un array' 
                });
            }
            if (tcodeSpec.mergeColumns && !Array.isArray(tcodeSpec.mergeColumns)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'mergeColumns debe ser un array' 
                });
            }
        } else {
            return res.status(400).json({ 
                success: false, 
                error: 'Especificación debe ser array u objeto con keyColumns/mergeColumns' 
            });
        }
        
        // Leer spec completo
        let spec = {};
        if (fs.existsSync(TCODE_SPEC_PATH)) {
            const content = fs.readFileSync(TCODE_SPEC_PATH, 'utf8');
            spec = JSON.parse(content);
        }
        
        // Actualizar TCODE específico
        spec[tcode] = tcodeSpec;
        
        // Escribir archivo
        fs.writeFileSync(TCODE_SPEC_PATH, JSON.stringify(spec, null, 2), 'utf8');
        res.json({ success: true, message: `TCODE ${tcode} actualizado correctamente` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE: Eliminar un TCODE
app.delete('/api/etl-consol/spec/:tcode', (req, res) => {
    try {
        if (!fs.existsSync(TCODE_SPEC_PATH)) {
            return res.status(404).json({ success: false, error: 'TCODE no encontrado' });
        }
        
        const content = fs.readFileSync(TCODE_SPEC_PATH, 'utf8');
        const spec = JSON.parse(content);
        const { tcode } = req.params;
        
        if (!spec[tcode]) {
            return res.status(404).json({ success: false, error: 'TCODE no encontrado' });
        }
        
        delete spec[tcode];
        fs.writeFileSync(TCODE_SPEC_PATH, JSON.stringify(spec, null, 2), 'utf8');
        res.json({ success: true, message: `TCODE ${tcode} eliminado correctamente` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener estado de etl-upsert
app.get('/api/etl-upsert/status', async (req, res) => {
  try {
    const http = require('http');
    const options = {
      hostname: '127.0.0.1',
      port: 3001,
      path: '/status',
      method: 'GET',
      timeout: 5000
    };
    
    const request = http.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          res.json(result);
        } catch (e) {
          res.json({ success: false, error: 'Error parseando respuesta' });
        }
      });
    });
    
    request.on('error', (error) => {
      res.status(500).json({ 
        success: false, 
        error: `Error al conectar con etl-upsert: ${error.message}` 
      });
    });
    
    request.on('timeout', () => {
      request.destroy();
      res.status(500).json({ 
        success: false, 
        error: 'Timeout al conectar con etl-upsert' 
      });
    });
    
    request.end();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ejecutar upsert manualmente
app.post('/api/etl-upsert/run', async (req, res) => {
  try {
    const http = require('http');
    const options = {
      hostname: '127.0.0.1',
      port: 3001,
      path: '/run',
      method: 'POST',
      timeout: 5000
    };
    
    const request = http.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          res.json(result);
        } catch (e) {
          res.json({ success: true, message: 'Procesamiento iniciado' });
        }
      });
    });
    
    request.on('error', (error) => {
      res.status(500).json({ 
        success: false, 
        error: `Error al conectar con etl-upsert: ${error.message}` 
      });
    });
    
    request.on('timeout', () => {
      request.destroy();
      res.status(500).json({ 
        success: false, 
        error: 'Timeout al conectar con etl-upsert' 
      });
    });
    
    request.end();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST: Toggle habilitar/deshabilitar TCODE
// Ejecutar consolidación manualmente
app.post('/api/etl-consol/run', async (req, res) => {
  try {
    const http = require('http');
    const options = {
      hostname: '127.0.0.1',
      port: 3003,
      path: '/run',
      method: 'POST',
      timeout: 5000
    };
    
    const request = http.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          res.json(result);
        } catch (e) {
          res.json({ success: true, message: 'Consolidación iniciada' });
        }
      });
    });
    
    request.on('error', (error) => {
      res.status(500).json({ 
        success: false, 
        error: `Error al conectar con etl-consol: ${error.message}` 
      });
    });
    
    request.on('timeout', () => {
      request.destroy();
      res.status(500).json({ 
        success: false, 
        error: 'Timeout al conectar con etl-consol' 
      });
    });
    
    request.end();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener estado de etl-analysis
app.get('/api/etl-analysis/status', async (req, res) => {
  try {
    const http = require('http');
    const options = {
      hostname: '127.0.0.1',
      port: 3002,
      path: '/status',
      method: 'GET',
      timeout: 5000
    };
    
    const request = http.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          res.json(result);
        } catch (e) {
          res.json({ success: false, error: 'Error parseando respuesta' });
        }
      });
    });
    
    request.on('error', (error) => {
      res.status(500).json({ 
        success: false, 
        error: `Error al conectar con etl-analysis: ${error.message}` 
      });
    });
    
    request.on('timeout', () => {
      request.destroy();
      res.status(500).json({ 
        success: false, 
        error: 'Timeout al conectar con etl-analysis' 
      });
    });
    
    request.end();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ejecutar analysis manualmente
app.post('/api/etl-analysis/run', async (req, res) => {
  try {
    const http = require('http');
    const options = {
      hostname: '127.0.0.1',
      port: 3002,
      path: '/run',
      method: 'POST',
      timeout: 5000
    };
    
    const request = http.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          res.json(result);
        } catch (e) {
          res.json({ success: true, message: 'Procesamiento iniciado' });
        }
      });
    });
    
    request.on('error', (error) => {
      res.status(500).json({ 
        success: false, 
        error: `Error al conectar con etl-analysis: ${error.message}` 
      });
    });
    
    request.on('timeout', () => {
      request.destroy();
      res.status(500).json({ 
        success: false, 
        error: 'Timeout al conectar con etl-analysis' 
      });
    });
    
    request.end();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/etl-consol/spec/:tcode/toggle', (req, res) => {
    try {
        if (!fs.existsSync(TCODE_SPEC_PATH)) {
            return res.status(404).json({ success: false, error: 'Archivo de especificación no encontrado' });
        }
        
        const content = fs.readFileSync(TCODE_SPEC_PATH, 'utf8');
        const spec = JSON.parse(content);
        const { tcode } = req.params;
        const { enabled } = req.body;
        
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ success: false, error: 'enabled debe ser un booleano' });
        }
        
        if (!spec[tcode]) {
            return res.status(404).json({ success: false, error: 'TCODE no encontrado' });
        }
        
        // Asegurar que el TCODE tenga la estructura correcta
        if (Array.isArray(spec[tcode])) {
            // Convertir formato antiguo (array) a nuevo
            spec[tcode] = {
                enabled: enabled,
                columns: spec[tcode]
            };
        } else if (typeof spec[tcode] === 'object' && spec[tcode] !== null) {
            // Formato nuevo: actualizar enabled
            if (spec[tcode].enabled === undefined) {
                spec[tcode].enabled = enabled;
            } else {
                spec[tcode].enabled = enabled;
            }
        } else {
            // Formato desconocido, crear estructura nueva
            spec[tcode] = {
                enabled: enabled,
                columns: []
            };
        }
        
        fs.writeFileSync(TCODE_SPEC_PATH, JSON.stringify(spec, null, 2), 'utf8');
        res.json({ success: true, message: `TCODE ${tcode} ${enabled ? 'habilitado' : 'deshabilitado'} correctamente` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint agregado para seguimiento de archivos a través de todo el pipeline
app.get('/api/track/:filename', async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const http = require('http');
    
    // Consultar estado en cada servicio
    const [analysisStatus, upsertStatus] = await Promise.allSettled([
      // Consultar etl-analysis
      new Promise((resolve, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port: 3002,
          path: `/track/${encodeURIComponent(filename)}`,
          method: 'GET',
          timeout: 15000 // Aumentado a 15 segundos para dar tiempo a verificar SFTP
        };
        const request = http.request(options, (response) => {
          let data = '';
          response.on('data', (chunk) => { data += chunk; });
          response.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (e) {
              resolve({ success: false, error: `Error parseando respuesta: ${e.message}`, rawData: data.substring(0, 200) });
            }
          });
        });
        request.on('error', (err) => {
          resolve({ success: false, error: `Error de conexión: ${err.message}` });
        });
        request.on('timeout', () => {
          request.destroy();
          resolve({ success: false, error: 'Timeout al conectar con etl-analysis (15s)' });
        });
        request.end();
      }),
      // Consultar etl-upsert
      new Promise((resolve, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port: 3001,
          path: `/track/${encodeURIComponent(filename)}`,
          method: 'GET',
          timeout: 10000 // 10 segundos para upsert
        };
        const request = http.request(options, (response) => {
          let data = '';
          response.on('data', (chunk) => { data += chunk; });
          response.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (e) {
              resolve({ success: false, error: `Error parseando respuesta: ${e.message}`, rawData: data.substring(0, 200) });
            }
          });
        });
        request.on('error', (err) => {
          resolve({ success: false, error: `Error de conexión: ${err.message}` });
        });
        request.on('timeout', () => {
          request.destroy();
          resolve({ success: false, error: 'Timeout al conectar con etl-upsert (10s)' });
        });
        request.end();
      })
    ]);
    
    const analysis = analysisStatus.status === 'fulfilled' ? analysisStatus.value : { success: false, error: analysisStatus.reason?.message };
    const upsert = upsertStatus.status === 'fulfilled' ? upsertStatus.value : { success: false, error: upsertStatus.reason?.message };
    
    // Construir respuesta agregada
    const pipeline = {
      step1_knfo: analysis?.success && analysis?.pipeline ? analysis.pipeline.step1_knfo : 'unknown',
      step2_meta: analysis?.success && analysis?.pipeline ? analysis.pipeline.step2_meta : 'unknown',
      step3_upsert: upsert?.success && upsert?.pipeline ? upsert.pipeline.step3_upsert : 'unknown',
      step4_consol: 'waiting' // Por ahora siempre waiting, se puede agregar lógica después
    };
    
    res.json({
      success: true,
      filename,
      analysis: analysis?.success ? (analysis.status || {}) : { error: analysis.error || 'Error desconocido' },
      upsert: upsert?.success ? (upsert.status || {}) : { error: upsert.error || 'Error desconocido' },
      pipeline,
      timestamp: new Date().toISOString(),
      // Incluir información de debug si hay errores
      debug: {
        analysisSuccess: analysis?.success || false,
        upsertSuccess: upsert?.success || false,
        analysisError: analysis?.error || null,
        upsertError: upsert?.error || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== MANTENEDOR DE TRIGGERS Y APIs ==========
const TRIGGERS_JSON_PATH = path.join(__dirname, 'data', 'triggers.json');

// Asegurar que el directorio data existe
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Función para leer triggers
function readTriggers() {
    try {
        if (fs.existsSync(TRIGGERS_JSON_PATH)) {
            const content = fs.readFileSync(TRIGGERS_JSON_PATH, 'utf8');
            return JSON.parse(content);
        }
    } catch (error) {
        console.error('Error leyendo triggers.json:', error);
    }
    return {};
}

// Función para guardar triggers
function saveTriggers(triggers) {
    try {
        fs.writeFileSync(TRIGGERS_JSON_PATH, JSON.stringify(triggers, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error guardando triggers.json:', error);
        return false;
    }
}

// Obtener todos los triggers
app.get('/api/triggers', (req, res) => {
    try {
        const triggers = readTriggers();
        res.json({ success: true, triggers });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear un nuevo trigger
app.post('/api/triggers', (req, res) => {
    try {
        const { name, description } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'El nombre del trigger es requerido' });
        }
        
        const triggers = readTriggers();
        const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        triggers[triggerId] = {
            id: triggerId,
            name: name.trim(),
            description: description || '',
            apis: [],
            tags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        if (saveTriggers(triggers)) {
            res.json({ success: true, trigger: triggers[triggerId] });
        } else {
            res.status(500).json({ success: false, error: 'Error al guardar el trigger' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Actualizar un trigger
app.put('/api/triggers/:triggerId', (req, res) => {
    try {
        const { triggerId } = req.params;
        const { name, description, tags } = req.body;
        
        const triggers = readTriggers();
        if (!triggers[triggerId]) {
            return res.status(404).json({ success: false, error: 'Trigger no encontrado' });
        }
        
        if (name !== undefined) triggers[triggerId].name = name.trim();
        if (description !== undefined) triggers[triggerId].description = description || '';
        if (tags !== undefined) {
            // Validar que tags sea un array
            if (Array.isArray(tags)) {
                triggers[triggerId].tags = tags;
            } else {
                return res.status(400).json({ success: false, error: 'tags debe ser un array' });
            }
        }
        triggers[triggerId].updatedAt = new Date().toISOString();
        
        if (saveTriggers(triggers)) {
            res.json({ success: true, trigger: triggers[triggerId] });
        } else {
            res.status(500).json({ success: false, error: 'Error al guardar el trigger' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Eliminar un trigger
app.delete('/api/triggers/:triggerId', (req, res) => {
    try {
        const { triggerId } = req.params;
        const triggers = readTriggers();
        
        if (!triggers[triggerId]) {
            return res.status(404).json({ success: false, error: 'Trigger no encontrado' });
        }
        
        delete triggers[triggerId];
        
        if (saveTriggers(triggers)) {
            res.json({ success: true, message: 'Trigger eliminado correctamente' });
        } else {
            res.status(500).json({ success: false, error: 'Error al guardar los cambios' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener APIs de un trigger
app.get('/api/triggers/:triggerId/apis', (req, res) => {
    try {
        const { triggerId } = req.params;
        const triggers = readTriggers();
        
        if (!triggers[triggerId]) {
            return res.status(404).json({ success: false, error: 'Trigger no encontrado' });
        }
        
        res.json({ success: true, apis: triggers[triggerId].apis || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Agregar una API a un trigger
app.post('/api/triggers/:triggerId/apis', (req, res) => {
    try {
        const { triggerId } = req.params;
        const { name, endpoint } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'El nombre de la API es requerido' });
        }
        
        if (!endpoint || !endpoint.trim()) {
            return res.status(400).json({ success: false, error: 'El endpoint de la API es requerido' });
        }
        
        const triggers = readTriggers();
        if (!triggers[triggerId]) {
            return res.status(404).json({ success: false, error: 'Trigger no encontrado' });
        }
        
        if (!triggers[triggerId].apis) {
            triggers[triggerId].apis = [];
        }
        
        const apiId = `api_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newApi = {
            id: apiId,
            name: name.trim(),
            endpoint: endpoint.trim(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        triggers[triggerId].apis.push(newApi);
        triggers[triggerId].updatedAt = new Date().toISOString();
        
        if (saveTriggers(triggers)) {
            res.json({ success: true, api: newApi });
        } else {
            res.status(500).json({ success: false, error: 'Error al guardar la API' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Actualizar una API
app.put('/api/triggers/:triggerId/apis/:apiId', (req, res) => {
    try {
        const { triggerId, apiId } = req.params;
        const { name, endpoint } = req.body;
        
        const triggers = readTriggers();
        if (!triggers[triggerId]) {
            return res.status(404).json({ success: false, error: 'Trigger no encontrado' });
        }
        
        const apiIndex = triggers[triggerId].apis.findIndex(api => api.id === apiId);
        if (apiIndex === -1) {
            return res.status(404).json({ success: false, error: 'API no encontrada' });
        }
        
        if (name !== undefined) triggers[triggerId].apis[apiIndex].name = name.trim();
        if (endpoint !== undefined) triggers[triggerId].apis[apiIndex].endpoint = endpoint.trim();
        triggers[triggerId].apis[apiIndex].updatedAt = new Date().toISOString();
        triggers[triggerId].updatedAt = new Date().toISOString();
        
        if (saveTriggers(triggers)) {
            res.json({ success: true, api: triggers[triggerId].apis[apiIndex] });
        } else {
            res.status(500).json({ success: false, error: 'Error al guardar la API' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Eliminar una API
app.delete('/api/triggers/:triggerId/apis/:apiId', (req, res) => {
    try {
        const { triggerId, apiId } = req.params;
        const triggers = readTriggers();
        
        if (!triggers[triggerId]) {
            return res.status(404).json({ success: false, error: 'Trigger no encontrado' });
        }
        
        const apiIndex = triggers[triggerId].apis.findIndex(api => api.id === apiId);
        if (apiIndex === -1) {
            return res.status(404).json({ success: false, error: 'API no encontrada' });
        }
        
        triggers[triggerId].apis.splice(apiIndex, 1);
        triggers[triggerId].updatedAt = new Date().toISOString();
        
        if (saveTriggers(triggers)) {
            res.json({ success: true, message: 'API eliminada correctamente' });
        } else {
            res.status(500).json({ success: false, error: 'Error al guardar los cambios' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener prefijos TCODE gestionados por etl_consolidacion (lista estática)
app.get('/api/tcode-prefixes', (req, res) => {
    try {
        // Prefijos TCODE que gestiona etl_consolidacion (desde scanProcessingState.js)
        const prefixes = [
            'MB51', 'ZMMREPO', 'ME5A', 'S_P99_41000062', 'ME2L', 'ZMMR_SQVI_BUS_RAPIDA',
            'KOB1', 'CJI3', 'KSB1', 'ZFIR_STATSLOAD', 'CN41N', 'ZRPT_PS_PROJECT', 'IW49N',
            'LEK2DAT_FORECAST', 'LEK2DAT_STRUCTURE_EE', 'LEK2DAT_STRUCTURE_CC',
            'LEK2DAT_STRUCTURE_CCEE', 'LEK2DAT_STRUCTURE_ACC'
        ];
        
        res.json({ success: true, prefixes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener tablas actuales de LEK-JOINED-DEV (nombres reales actuales)
app.get('/api/current-tables', async (req, res) => {
    try {
        const mysql = require('mysql2/promise');
        const {
            DB_HOST = '10.4.0.190',
            DB_PORT = '3306',
            DB_USER = 'fits',
            DB_PASS = 'fits.2024',
            DB_JOINED_NAME = 'LEK-JOINED-DEV'
        } = process.env;

        let connection = null;
        try {
            connection = await mysql.createConnection({
                host: DB_HOST,
                port: Number(DB_PORT),
                user: DB_USER,
                password: DB_PASS,
                database: DB_JOINED_NAME,
                connectTimeout: 10000
            });

            const [rows] = await connection.execute(
                `SELECT TABLE_NAME 
                 FROM information_schema.TABLES 
                 WHERE TABLE_SCHEMA = ? 
                 ORDER BY TABLE_NAME`,
                [DB_JOINED_NAME]
            );

            const tables = rows.map(row => row.TABLE_NAME);
            res.json({ success: true, tables });
        } catch (error) {
            console.error('[API] Error obteniendo tablas:', error.message);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            if (connection) {
                await connection.end();
            }
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Ejecutar una API externa (para evitar problemas de CORS)
app.post('/api/execute-api', async (req, res) => {
    try {
        const { endpoint } = req.body;
        
        if (!endpoint || !endpoint.trim()) {
            return res.status(400).json({ success: false, error: 'El endpoint es requerido' });
        }
        
        let url = endpoint.trim();
        
        // Validar que sea una URL válida
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return res.status(400).json({ success: false, error: 'El endpoint debe ser una URL completa (http:// o https://)' });
        }
        
        const http = require('http');
        const https = require('https');
        const urlModule = require('url');
        
        const parsedUrl = urlModule.parse(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.path,
            method: 'GET',
            timeout: 30000, // 30 segundos
            headers: {
                'User-Agent': 'ETL-Monitor/1.0',
                'Accept': 'application/json'
            }
        };
        
        const result = await new Promise((resolve, reject) => {
            const request = client.request(options, (response) => {
                let data = '';
                
                response.on('data', (chunk) => {
                    data += chunk;
                });
                
                response.on('end', () => {
                    resolve({
                        success: true,
                        status: response.statusCode,
                        statusText: response.statusMessage,
                        headers: response.headers,
                        data: data
                    });
                });
                
                response.on('error', (error) => {
                    resolve({
                        success: false,
                        error: `Error en la respuesta: ${error.message}`,
                        code: error.code
                    });
                });
            });
            
            request.on('error', (error) => {
                let errorMessage = error.message;
                if (error.code === 'ENOTFOUND') {
                    errorMessage = `No se pudo resolver el hostname: ${parsedUrl.hostname}`;
                } else if (error.code === 'ECONNREFUSED') {
                    errorMessage = `Conexión rechazada por el servidor: ${parsedUrl.hostname}`;
                } else if (error.code === 'ETIMEDOUT') {
                    errorMessage = `Timeout: La conexión tardó demasiado`;
                }
                
                resolve({
                    success: false,
                    error: errorMessage,
                    code: error.code
                });
            });
            
            request.on('timeout', () => {
                request.destroy();
                resolve({
                    success: false,
                    error: 'Timeout: La API no respondió en 30 segundos'
                });
            });
            
            request.setTimeout(30000);
            request.end();
        });
        
        res.json(result);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Configurar Socket.IO
io.on('connection', (socket) => {
    console.log(`[${new Date().toISOString()}] [SOCKET] Cliente conectado: ${socket.id}`);
    
    socket.on('disconnect', () => {
        console.log(`[${new Date().toISOString()}] [SOCKET] Cliente desconectado: ${socket.id}`);
    });
    
    // Enviar estado inicial del monitoreo
    socket.emit('monitor_status', tableMonitor.getStatus());
});

// Función para ejecutar triggers automáticamente cuando hay cambios de tablas
async function executeMatchingTriggers(tableName, changeType, renameInfo = null) {
    try {
        const triggers = readTriggers();
        const matchingTriggers = [];
        
        // Buscar triggers que tengan el tag coincidente
        for (const [triggerId, trigger] of Object.entries(triggers)) {
            const tags = trigger.tags || [];
            
            // Verificar si algún tag coincide con el nombre de la tabla
            const matchingTag = tags.find(tag => {
                // Comparar el tag con el nombre completo o el TCODE base
                const tagTcode = tableMonitor.extractTcodeBase(tag);
                const tableTcode = tableMonitor.extractTcodeBase(tableName);
                return tag === tableName || tagTcode === tableTcode;
            });
            
            if (matchingTag) {
                matchingTriggers.push({
                    triggerId,
                    trigger,
                    matchingTag
                });
                
                // Si es un renombrado, actualizar el tag al nuevo nombre
                if (changeType === 'renamed' && renameInfo) {
                    const tagIndex = tags.indexOf(matchingTag);
                    if (tagIndex !== -1) {
                        // Actualizar el tag al nuevo nombre (mantener el nombre completo actual)
                        tags[tagIndex] = renameInfo.newName;
                        trigger.tags = tags;
                        trigger.updatedAt = new Date().toISOString();
                        console.log(`[${new Date().toISOString()}] [TRIGGER_AUTO] Tag actualizado en trigger "${trigger.name}": ${matchingTag} -> ${renameInfo.newName}`);
                    }
                }
            }
        }
        
        // Guardar cambios si hubo actualizaciones de tags
        if (changeType === 'renamed' && matchingTriggers.length > 0) {
            saveTriggers(triggers);
        }
        
        // Ejecutar los triggers encontrados
        if (matchingTriggers.length > 0) {
            console.log(`[${new Date().toISOString()}] [TRIGGER_AUTO] Ejecutando ${matchingTriggers.length} trigger(s) para tabla "${tableName}" (${changeType})`);
            
            // Enviar evento de inicio de ejecución automática
            if (io) {
                io.emit('trigger_auto_execution_start', {
                    tableName,
                    changeType,
                    renameInfo,
                    totalTriggers: matchingTriggers.length,
                    triggers: matchingTriggers.map(t => ({
                        id: t.triggerId,
                        name: t.trigger.name,
                        apiCount: t.trigger.apis?.length || 0
                    }))
                });
            }
            
            for (let triggerIdx = 0; triggerIdx < matchingTriggers.length; triggerIdx++) {
                const { triggerId, trigger } = matchingTriggers[triggerIdx];
                console.log(`[${new Date().toISOString()}] [TRIGGER_AUTO] Ejecutando trigger: ${trigger.name} (${triggerId})`);
                
                // Enviar evento de inicio de trigger
                if (io) {
                    io.emit('trigger_auto_execution_trigger', {
                        triggerId,
                        triggerName: trigger.name,
                        triggerIndex: triggerIdx + 1,
                        totalTriggers: matchingTriggers.length
                    });
                }
                
                // Ejecutar cada API del trigger secuencialmente
                const apis = trigger.apis || [];
                for (let i = 0; i < apis.length; i++) {
                    const api = apis[i];
                    try {
                        console.log(`[${new Date().toISOString()}] [TRIGGER_AUTO] Ejecutando API ${i + 1}/${apis.length}: ${api.name}`);
                        
                        // Enviar evento de inicio de API
                        if (io) {
                            io.emit('trigger_auto_execution_api', {
                                triggerId,
                                triggerName: trigger.name,
                                apiId: api.id,
                                apiName: api.name,
                                apiIndex: i + 1,
                                totalApis: apis.length,
                                endpoint: api.endpoint
                            });
                        }
                        
                        // Usar la misma lógica que el endpoint /api/execute-api
                        const http = require('http');
                        const https = require('https');
                        const urlModule = require('url');
                        
                        let url = api.endpoint.trim();
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                            console.warn(`[${new Date().toISOString()}] [TRIGGER_AUTO] URL inválida: ${url}`);
                            continue;
                        }
                        
                        const parsedUrl = urlModule.parse(url);
                        const isHttps = parsedUrl.protocol === 'https:';
                        const client = isHttps ? https : http;
                        
                        const options = {
                            hostname: parsedUrl.hostname,
                            port: parsedUrl.port || (isHttps ? 443 : 80),
                            path: parsedUrl.path,
                            method: 'GET',
                            timeout: 30000,
                            headers: {
                                'User-Agent': 'ETL-Monitor/1.0',
                                'Accept': 'application/json'
                            }
                        };
                        
                        const result = await new Promise((resolve) => {
                            const request = client.request(options, (response) => {
                                let data = '';
                                response.on('data', (chunk) => { data += chunk; });
                                response.on('end', () => {
                                    resolve({
                                        success: response.statusCode === 200,
                                        status: response.statusCode,
                                        data: data
                                    });
                                });
                                response.on('error', (error) => {
                                    resolve({ success: false, error: error.message });
                                });
                            });
                            
                            request.on('error', (error) => {
                                resolve({ success: false, error: error.message });
                            });
                            
                            request.on('timeout', () => {
                                request.destroy();
                                resolve({ success: false, error: 'Timeout' });
                            });
                            
                            request.setTimeout(30000);
                            request.end();
                        });
                        
                        if (result.success) {
                            console.log(`[${new Date().toISOString()}] [TRIGGER_AUTO] ✅ API "${api.name}" ejecutada exitosamente (${result.status})`);
                            
                            // Enviar evento de éxito de API
                            if (io) {
                                io.emit('trigger_auto_execution_api_result', {
                                    triggerId,
                                    triggerName: trigger.name,
                                    apiId: api.id,
                                    apiName: api.name,
                                    success: true,
                                    status: result.status,
                                    apiIndex: i + 1,
                                    totalApis: apis.length
                                });
                            }
                        } else {
                            console.error(`[${new Date().toISOString()}] [TRIGGER_AUTO] ❌ Error en API "${api.name}": ${result.error || 'Unknown error'}`);
                            
                            // Enviar evento de error de API
                            if (io) {
                                io.emit('trigger_auto_execution_api_result', {
                                    triggerId,
                                    triggerName: trigger.name,
                                    apiId: api.id,
                                    apiName: api.name,
                                    success: false,
                                    error: result.error || 'Unknown error',
                                    apiIndex: i + 1,
                                    totalApis: apis.length
                                });
                            }
                        }
                        
                        // Esperar un poco entre APIs para no sobrecargar
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                    } catch (apiError) {
                        console.error(`[${new Date().toISOString()}] [TRIGGER_AUTO] Error ejecutando API "${api.name}":`, apiError.message);
                        
                        // Enviar evento de error de API
                        if (io) {
                            io.emit('trigger_auto_execution_api_result', {
                                triggerId,
                                triggerName: trigger.name,
                                apiId: api.id,
                                apiName: api.name,
                                success: false,
                                error: apiError.message,
                                apiIndex: i + 1,
                                totalApis: apis.length
                            });
                        }
                    }
                }
                
                // Enviar evento de finalización de trigger
                if (io) {
                    io.emit('trigger_auto_execution_trigger_complete', {
                        triggerId,
                        triggerName: trigger.name,
                        triggerIndex: triggerIdx + 1,
                        totalTriggers: matchingTriggers.length
                    });
                }
            }
            
            // Enviar evento de finalización de ejecución automática
            if (io) {
                io.emit('trigger_auto_execution_complete', {
                    tableName,
                    changeType,
                    totalTriggers: matchingTriggers.length
                });
            }
        } else {
            console.log(`[${new Date().toISOString()}] [TRIGGER_AUTO] No se encontraron triggers con tags coincidentes para "${tableName}"`);
        }
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] [TRIGGER_AUTO] Error ejecutando triggers:`, error.message);
    }
}

// Iniciar monitoreo de tablas con función de ejecución de triggers
tableMonitor.startMonitoring(io, async (tableName, changeType, renameInfo) => {
    await executeMatchingTriggers(tableName, changeType, renameInfo);
});

// Endpoint para obtener estado del monitoreo
app.get('/api/table-monitor/status', (req, res) => {
    try {
        res.json({ success: true, status: tableMonitor.getStatus() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint para iniciar/detener monitoreo manualmente
app.post('/api/table-monitor/:action', (req, res) => {
    try {
        const { action } = req.params;
        
        if (action === 'start') {
            tableMonitor.startMonitoring(io);
            res.json({ success: true, message: 'Monitoreo iniciado' });
        } else if (action === 'stop') {
            tableMonitor.stopMonitoring();
            res.json({ success: true, message: 'Monitoreo detenido' });
        } else {
            res.status(400).json({ success: false, error: 'Acción inválida. Use "start" o "stop"' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Inicio del servidor
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor ETL Monitor corriendo en http://0.0.0.0:${PORT}`);
    console.log(`📊 Accede desde: http://localhost:${PORT} o http://[IP]:${PORT}`);
    console.log(`🔔 Socket.IO habilitado para notificaciones en tiempo real`);
});



