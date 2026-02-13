// tableMonitor.js
// Servicio de monitoreo de cambios en nombres de tablas de LEK-JOINED-DEV

const mysql = require('mysql2/promise');

// Configuración de base de datos (usar las mismas variables de entorno que etl_consol)
const {
  DB_HOST = '10.4.0.190',
  DB_PORT = '3306',
  DB_USER = 'fits',
  DB_PASS = 'fits.2024',
  DB_JOINED_NAME = 'LEK-JOINED-DEV',
  MONITOR_INTERVAL_MS = 60000 // 1 minuto por defecto
} = process.env;

let currentTables = new Set();
let isMonitoring = false;
let monitorInterval = null;
let io = null; // Socket.IO instance (se asignará desde server.js)
let triggerExecutor = null; // Función para ejecutar triggers (se asignará desde server.js)

/**
 * Obtiene la lista de nombres de tablas de LEK-JOINED-DEV
 */
async function getTableNames() {
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

    return new Set(rows.map(row => row.TABLE_NAME));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [TABLE_MONITOR] Error obteniendo tablas:`, error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

/**
 * Extrae el TCODE base de un nombre de tabla
 * Las tablas pueden tener sufijos como $hash, pero el TCODE base es lo importante
 */
function extractTcodeBase(tableName) {
  // Remover sufijos comunes como $hash, _temp, etc.
  // Ejemplo: ME2L$FBBG7Y5h -> ME2L
  const match = tableName.match(/^([A-Z0-9_]+)/);
  return match ? match[1] : tableName;
}

/**
 * Compara las tablas actuales con las anteriores y detecta cambios
 * Incluye detección de renombrados basándose en TCODE base
 */
function detectChanges(newTables, oldTables) {
  const added = [];
  const removed = [];
  const renamed = []; // { oldName, newName, tcodeBase }
  const changed = [];

  // Crear mapas de TCODE base -> lista de tablas
  const oldTcodeMap = new Map();
  const newTcodeMap = new Map();

  for (const table of oldTables) {
    const tcode = extractTcodeBase(table);
    if (!oldTcodeMap.has(tcode)) {
      oldTcodeMap.set(tcode, []);
    }
    oldTcodeMap.get(tcode).push(table);
  }

  for (const table of newTables) {
    const tcode = extractTcodeBase(table);
    if (!newTcodeMap.has(tcode)) {
      newTcodeMap.set(tcode, []);
    }
    newTcodeMap.get(tcode).push(table);
  }

  // Detectar renombrados: mismo TCODE base, pero nombres diferentes
  for (const [tcode, oldTablesList] of oldTcodeMap.entries()) {
    const newTablesList = newTcodeMap.get(tcode) || [];
    
    // Si hay tablas con el mismo TCODE pero nombres diferentes, es un renombrado
    if (oldTablesList.length === 1 && newTablesList.length === 1) {
      const oldName = oldTablesList[0];
      const newName = newTablesList[0];
      
      if (oldName !== newName) {
        // Es un renombrado
        renamed.push({
          oldName: oldName,
          newName: newName,
          tcodeBase: tcode
        });
        // No contar como agregada/eliminada
        continue;
      }
    }
  }

  // Tablas nuevas (que no son renombrados)
  for (const table of newTables) {
    const tcode = extractTcodeBase(table);
    const oldTablesList = oldTcodeMap.get(tcode) || [];
    
    // Si no hay tabla antigua con este TCODE, o esta tabla específica no existe en las antiguas
    const isRenamed = renamed.some(r => r.newName === table);
    if (!isRenamed && !oldTables.has(table)) {
      // Verificar si es realmente nueva o si todas las del TCODE fueron eliminadas
      const allOldTablesOfTcode = oldTablesList.filter(t => oldTables.has(t));
      if (allOldTablesOfTcode.length === 0) {
        added.push(table);
      }
    }
  }

  // Tablas eliminadas (que no son renombrados)
  for (const table of oldTables) {
    const isRenamed = renamed.some(r => r.oldName === table);
    if (!isRenamed && !newTables.has(table)) {
      removed.push(table);
    }
  }

  return { added, removed, renamed, changed };
}

/**
 * Envía notificación a través de Socket.IO
 */
function sendNotification(type, data) {
  if (!io) {
    console.warn(`[${new Date().toISOString()}] [TABLE_MONITOR] Socket.IO no inicializado, no se puede enviar notificación`);
    return;
  }

  const notification = {
    type: 'table_change',
    timestamp: new Date().toISOString(),
    changeType: type, // 'added', 'removed', 'renamed', 'multiple'
    data: data
  };

  io.emit('table_change', notification);
  console.log(`[${new Date().toISOString()}] [TABLE_MONITOR] Notificación enviada:`, JSON.stringify(notification));
}

/**
 * Busca y ejecuta triggers que tengan el tag coincidente con el nombre de tabla
 */
async function executeMatchingTriggers(tableName, changeType, renameInfo = null) {
  if (!triggerExecutor) {
    console.warn(`[${new Date().toISOString()}] [TABLE_MONITOR] triggerExecutor no disponible`);
    return;
  }

  try {
    await triggerExecutor(tableName, changeType, renameInfo);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [TABLE_MONITOR] Error ejecutando triggers:`, error.message);
  }
}

/**
 * Ejecuta una verificación de cambios
 */
async function checkForChanges() {
  if (!isMonitoring) {
    return;
  }

  try {
    const newTables = await getTableNames();
    
    // Primera ejecución: solo guardar el estado inicial
    if (currentTables.size === 0) {
      currentTables = newTables;
      console.log(`[${new Date().toISOString()}] [TABLE_MONITOR] Estado inicial: ${currentTables.size} tabla(s) detectada(s)`);
      return;
    }

    // Comparar con el estado anterior
    const changes = detectChanges(newTables, currentTables);

    if (changes.added.length > 0 || changes.removed.length > 0 || changes.renamed.length > 0) {
      console.log(`[${new Date().toISOString()}] [TABLE_MONITOR] Cambios detectados:`, changes);
      
      // Procesar renombrados primero
      for (const rename of changes.renamed) {
        console.log(`[${new Date().toISOString()}] [TABLE_MONITOR] Tabla renombrada: ${rename.oldName} -> ${rename.newName} (TCODE: ${rename.tcodeBase})`);
        
        sendNotification('renamed', {
          oldName: rename.oldName,
          newName: rename.newName,
          tcodeBase: rename.tcodeBase,
          totalTables: newTables.size
        });
        
        // Ejecutar triggers que tengan el tag con el nombre antiguo y pasar info de renombrado
        await executeMatchingTriggers(rename.oldName, 'renamed', rename);
      }
      
      // Enviar notificaciones para agregadas y eliminadas
      if (changes.added.length > 0 && changes.removed.length > 0) {
        // Cambios múltiples
        sendNotification('multiple', {
          added: changes.added,
          removed: changes.removed,
          renamed: changes.renamed,
          totalTables: newTables.size
        });
      } else if (changes.added.length > 0) {
        // Solo tablas nuevas
        for (const table of changes.added) {
          sendNotification('added', {
            table: table,
            totalTables: newTables.size
          });
          await executeMatchingTriggers(table, 'added');
        }
      } else if (changes.removed.length > 0) {
        // Solo tablas eliminadas
        for (const table of changes.removed) {
          sendNotification('removed', {
            table: table,
            totalTables: newTables.size
          });
          await executeMatchingTriggers(table, 'removed');
        }
      }

      // Actualizar estado actual
      currentTables = newTables;
    } else {
      console.log(`[${new Date().toISOString()}] [TABLE_MONITOR] Sin cambios (${newTables.size} tabla(s))`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [TABLE_MONITOR] Error en verificación:`, error.message);
  }
}

/**
 * Inicia el monitoreo
 */
function startMonitoring(socketIOInstance, executorFunction = null) {
  if (isMonitoring) {
    console.warn(`[${new Date().toISOString()}] [TABLE_MONITOR] El monitoreo ya está activo`);
    return;
  }

  io = socketIOInstance;
  triggerExecutor = executorFunction;
  isMonitoring = true;
  currentTables.clear(); // Resetear estado

  const intervalMs = Number(MONITOR_INTERVAL_MS) || 60000;
  
  console.log(`[${new Date().toISOString()}] [TABLE_MONITOR] Iniciando monitoreo (intervalo: ${intervalMs}ms)`);
  
  // Ejecutar inmediatamente la primera verificación
  checkForChanges();
  
  // Programar verificaciones periódicas
  monitorInterval = setInterval(() => {
    checkForChanges();
  }, intervalMs);
}

/**
 * Detiene el monitoreo
 */
function stopMonitoring() {
  if (!isMonitoring) {
    return;
  }

  isMonitoring = false;
  
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }

  console.log(`[${new Date().toISOString()}] [TABLE_MONITOR] Monitoreo detenido`);
}

/**
 * Obtiene el estado actual del monitoreo
 */
function getStatus() {
  return {
    isMonitoring,
    currentTableCount: currentTables.size,
    intervalMs: Number(MONITOR_INTERVAL_MS) || 60000,
    lastCheck: currentTables.size > 0 ? new Date().toISOString() : null
  };
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  getStatus,
  checkForChanges, // Para pruebas manuales
  extractTcodeBase // Exportar para uso externo
};

